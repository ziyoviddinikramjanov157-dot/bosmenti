import { z } from 'zod'
import { SIZES, type SizeKey } from '../catalog-rules.js'
import { tx, type Client, type Db } from '../db.js'
import { HttpError } from '../errors.js'
import { activeDiscounts, discounted, discountPercent, ean13ForVariant } from './pricing.js'

export interface Variant { id: number; productId: string; color: string; size: string; stock: number }
interface VariantRow { id: number; product_id: string; color: string; size: string; stock: number }
const toVariant = (r: VariantRow): Variant => ({ id: r.id, productId: r.product_id, color: r.color, size: r.size, stock: r.stock })

/** Finds or creates the stock row for one colour and size of a product. */
export async function ensureVariant(c: Client, productId: string, color: string, size: string): Promise<Variant> {
  const { rows } = await c.query<{ colors: { n: string }[]; size_key: SizeKey }>('SELECT colors, size_key FROM products WHERE id = $1', [productId])
  const p = rows[0]
  if (!p) throw new HttpError(404, 'Mahsulot topilmadi')
  if (!p.colors.some(x => x.n === color)) throw new HttpError(400, `Bu mahsulotda «${color}» rangi yo‘q`)
  if (!SIZES[p.size_key]?.includes(size)) throw new HttpError(400, `Bu mahsulotda ${size} o‘lchami yo‘q`)
  await c.query('INSERT INTO variants (product_id, color, size) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [productId, color, size])
  const v = await c.query<VariantRow>('SELECT * FROM variants WHERE product_id = $1 AND color = $2 AND size = $3', [productId, color, size])
  return toVariant(v.rows[0])
}

/** A colour/size with the product's current (discounted) price, as the till and intake screens show it. */
async function describe(db: Client, where: string, value: string | number) {
  const { rows } = await db.query<VariantRow & { name: string; price: number; images: string[]; category_id: string }>(
    `SELECT v.*, p.name, p.price, p.images, p.category_id
     FROM variants v JOIN products p ON p.id = v.product_id ${where}`,
    [value],
  )
  const r = rows[0]
  if (!r) return null
  const pct = discountPercent({ id: r.product_id, cat: r.category_id }, await activeDiscounts(db))
  return {
    variant: toVariant(r),
    product: { id: r.product_id, name: r.name, basePrice: r.price, price: discounted(r.price, pct), discount: pct, image: r.images[0] ?? null },
  }
}

/** What the cash register needs to know about a scanned code. */
export async function lookupCode(db: Client, code: string) {
  const found = await describe(db, 'WHERE v.id = (SELECT variant_id FROM barcodes WHERE code = $1)', code.trim())
  if (!found) throw new HttpError(404, 'Bu kod hali hech qaysi kiyimga bog‘lanmagan', { code: code.trim() })
  return { code: code.trim(), ...found }
}

export const VariantInput = z.object({ productId: z.string().min(1), color: z.string().min(1), size: z.string().min(1) })

/** For items picked by hand, without scanning. */
export async function variantInfo(db: Client, v: z.infer<typeof VariantInput>) {
  const { id } = await ensureVariant(db, v.productId, v.color, v.size)
  return (await describe(db, 'WHERE v.id = $1', id))!
}

export const BindInput = z.object({
  code: z.string().trim().min(3, 'Kod juda qisqa').max(64),
  productId: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
})

export async function bindCode(db: Db, b: z.infer<typeof BindInput>) {
  return tx(db, async c => {
    const v = await ensureVariant(c, b.productId, b.color, b.size)
    const taken = await c.query<{ variant_id: number }>('SELECT variant_id FROM barcodes WHERE code = $1', [b.code])
    if (taken.rows[0] && taken.rows[0].variant_id !== v.id) throw new HttpError(409, 'Bu kod boshqa kiyimga bog‘langan')
    await c.query('INSERT INTO barcodes (code, variant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [b.code, v.id])
    return v
  })
}

export const IntakeInput = z.object({
  lines: z.array(z.object({ variantId: z.number().int().positive(), qty: z.number().int().min(1).max(10_000) })).min(1, 'Kirim bo‘sh').max(500),
  note: z.string().trim().max(300).default(''),
})

/** New goods arrived: stock goes up, and the shop starts tracking stock for these products. */
export async function intake(db: Db, input: z.infer<typeof IntakeInput>) {
  return tx(db, async c => {
    for (const l of input.lines) {
      const { rows } = await c.query<VariantRow>('UPDATE variants SET stock = stock + $2 WHERE id = $1 RETURNING *', [l.variantId, l.qty])
      if (!rows[0]) throw new HttpError(404, 'Kiyim topilmadi')
      await c.query("INSERT INTO stock_moves (variant_id, qty, reason, note) VALUES ($1, $2, 'intake', $3)", [l.variantId, l.qty, input.note])
      await c.query('UPDATE products SET track_stock = true WHERE id = $1', [rows[0].product_id])
    }
    return { count: input.lines.reduce((s, l) => s + l.qty, 0) }
  })
}

export const AdjustInput = z.object({
  variantId: z.number().int().positive(),
  stock: z.number().int().min(-10_000).max(100_000),
  note: z.string().trim().max(300).default(''),
})

/** After a recount: sets the exact number on the shelf and records the difference. */
export async function adjustStock(db: Db, a: z.infer<typeof AdjustInput>) {
  return tx(db, async c => {
    const { rows } = await c.query<VariantRow>('SELECT * FROM variants WHERE id = $1 FOR UPDATE', [a.variantId])
    if (!rows[0]) throw new HttpError(404, 'Kiyim topilmadi')
    const diff = a.stock - rows[0].stock
    if (diff) {
      await c.query('UPDATE variants SET stock = $2 WHERE id = $1', [a.variantId, a.stock])
      await c.query("INSERT INTO stock_moves (variant_id, qty, reason, note) VALUES ($1, $2, 'adjust', $3)", [a.variantId, diff, a.note])
    }
    return toVariant({ ...rows[0], stock: a.stock })
  })
}

/** Every product with its colour/size rows and their codes, for the stock screen. */
export async function stockList(db: Client) {
  const [products, variants, codes] = await Promise.all([
    db.query<{ id: string; name: string; category_id: string; price: number; colors: { n: string; c: string }[]; size_key: SizeKey; images: string[]; track_stock: boolean; is_active: boolean }>(
      'SELECT id, name, category_id, price, colors, size_key, images, track_stock, is_active FROM products ORDER BY sort, created_at',
    ),
    db.query<VariantRow>('SELECT * FROM variants ORDER BY id'),
    db.query<{ code: string; variant_id: number }>('SELECT code, variant_id FROM barcodes ORDER BY code'),
  ])
  return products.rows.map(p => ({
    id: p.id, name: p.name, cat: p.category_id, price: p.price, colors: p.colors, sizes: SIZES[p.size_key] ?? [],
    image: p.images[0] ?? null, track: p.track_stock, active: p.is_active,
    variants: variants.rows
      .filter(v => v.product_id === p.id)
      .map(v => ({ ...toVariant(v), codes: codes.rows.filter(x => x.variant_id === v.id).map(x => x.code) })),
  }))
}

export const LabelsInput = z.object({
  items: z.array(z.object({ productId: z.string().min(1), color: z.string().min(1), size: z.string().min(1), copies: z.number().int().min(1).max(500) })).min(1).max(200),
})

/** Each label gets the shop's own EAN-13 code for that colour and size, created on first print. */
export async function labels(db: Db, input: z.infer<typeof LabelsInput>) {
  return tx(db, async c => {
    const discounts = await activeDiscounts(c)
    const out: { code: string; name: string; color: string; size: string; price: number; copies: number }[] = []
    for (const it of input.items) {
      const v = await ensureVariant(c, it.productId, it.color, it.size)
      const code = ean13ForVariant(v.id)
      await c.query('INSERT INTO barcodes (code, variant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [code, v.id])
      const p = (await c.query<{ name: string; price: number; category_id: string }>('SELECT name, price, category_id FROM products WHERE id = $1', [it.productId])).rows[0]
      const price = discounted(p.price, discountPercent({ id: it.productId, cat: p.category_id }, discounts))
      out.push({ code, name: p.name, color: it.color, size: it.size, price, copies: it.copies })
    }
    return out
  })
}

export async function stockMoves(db: Client, { reason, from, to }: { reason?: string; from?: string; to?: string }) {
  const { rows } = await db.query<{ id: number; qty: number; reason: string; note: string; created_at: Date; name: string; color: string; size: string; order_no: number | null }>(
    `SELECT m.id, m.qty, m.reason, m.note, m.created_at, p.name, v.color, v.size, o.no AS order_no
     FROM stock_moves m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
     LEFT JOIN orders o ON o.id = m.order_id
     WHERE ($1::text IS NULL OR m.reason = $1) AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at < $3)
     ORDER BY m.created_at DESC, m.id DESC LIMIT 300`,
    [reason ?? null, from ?? null, to ?? null],
  )
  return rows.map(r => ({ id: r.id, qty: r.qty, reason: r.reason, note: r.note, createdAt: r.created_at.toISOString(), name: r.name, color: r.color, size: r.size, orderNo: r.order_no }))
}

/** Moves stock for the items of a sale: -1 when sold, +1 when the sale is cancelled. */
export async function moveSaleStock(c: Client, orderId: number, sign: 1 | -1) {
  const { rows } = await c.query<{ variant_id: number; qty: number }>('SELECT variant_id, qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL', [orderId])
  for (const r of rows) {
    await c.query('UPDATE variants SET stock = stock + $2 WHERE id = $1', [r.variant_id, sign * r.qty])
    await c.query('INSERT INTO stock_moves (variant_id, qty, reason, order_id) VALUES ($1, $2, $3, $4)', [r.variant_id, sign * r.qty, sign < 0 ? 'sale' : 'cancel', orderId])
  }
}
