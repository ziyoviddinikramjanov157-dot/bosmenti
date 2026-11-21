import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ORDER_STATUSES, SIZES, type SizeKey } from '../catalog-rules.js'
import { tx, type Client, type Db } from '../db.js'
import { HttpError } from '../errors.js'
import { money } from '../format.js'
import { activeDiscounts, discounted, discountPercent } from './pricing.js'
import { getSettings } from './settings.js'
import { moveSaleStock } from './stock.js'

/* An "order" is any sale: placed on the website (channel "online") or rung up at the till (channel "store"). */

export const OrderInput = z
  .object({
    name: z.string().trim().min(2, 'Ismingizni kiriting').max(60),
    phone: z.string().regex(/^\d{9}$/, 'Telefon raqamni to‘liq kiriting: 9 ta raqam'),
    ship: z.enum(['delivery', 'pickup']),
    address: z.string().trim().max(200).default(''),
    pay: z.enum(['cash', 'card']),
    cardType: z.enum(['Uzcard', 'Humo', 'Visa']).optional(),
    note: z.string().trim().max(300).default(''),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          ci: z.number().int().min(0).max(50),
          size: z.string().min(1).max(20),
          qty: z.number().int().min(1).max(10),
        }),
      )
      .min(1, 'Savat bo‘sh')
      .max(30),
  })
  .superRefine((v, ctx) => {
    if (v.ship === 'delivery' && v.address.length < 5)
      ctx.addIssue({ code: 'custom', path: ['address'], message: 'Yetkazib berish manzilini kiriting' })
  })
export type OrderInput = z.infer<typeof OrderInput>

import { payState, type PayState } from '../pos-rules.js'

export interface OrderItem { productId: string; name: string; color: string; size: string; price: number; basePrice: number; qty: number; image: string | null }
export interface Payment { id: number; amount: number; method: 'cash' | 'card'; note: string; createdAt: string }
export interface Order {
  no: number; token: string; channel: 'online' | 'store'; name: string; phone: string; ship: 'delivery' | 'pickup'; address: string
  pay: 'cash' | 'card' | 'mixed' | 'credit'; cardType: string | null; note: string; itemsTotal: number; discountTotal: number
  shipFee: number; total: number; paid: number; debt: number; payState: PayState; dueDate: string | null
  status: (typeof ORDER_STATUSES)[number]; adminNote: string; createdAt: string; updatedAt: string
  items: OrderItem[]; payments: Payment[]
}

interface OrderRow {
  id: number; no: number; token: string; channel: Order['channel']; customer_name: string; phone: string; ship: Order['ship']
  address: string; pay: Order['pay']; card_type: string | null; note: string; items_total: number; discount_total: number
  ship_fee: number; total: number; due_date: string | null; status: Order['status']; admin_note: string; created_at: Date; updated_at: Date
}
interface ItemRow { order_id: number; product_id: string; name: string; color: string; size: string; price: number; base_price: number | null; qty: number; image: string | null }
interface PaymentRow { id: number; order_id: number; amount: number; method: Payment['method']; note: string; created_at: Date }

const toOrder = (o: OrderRow, items: ItemRow[], payments: PaymentRow[]): Order => {
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  return {
    no: o.no, token: o.token, channel: o.channel, name: o.customer_name, phone: o.phone, ship: o.ship, address: o.address,
    pay: o.pay, cardType: o.card_type, note: o.note, itemsTotal: o.items_total, discountTotal: o.discount_total,
    shipFee: o.ship_fee, total: o.total, paid, debt: Math.max(0, o.total - paid), payState: payState(o.total, paid),
    dueDate: o.due_date, status: o.status, adminNote: o.admin_note,
    createdAt: o.created_at.toISOString(), updatedAt: o.updated_at.toISOString(),
    items: items.map(i => ({ productId: i.product_id, name: i.name, color: i.color, size: i.size, price: i.price, basePrice: i.base_price ?? i.price, qty: i.qty, image: i.image })),
    payments: payments.map(p => ({ id: p.id, amount: p.amount, method: p.method, note: p.note, createdAt: p.created_at.toISOString() })),
  }
}

/** What a customer may see about their own order: no internal notes or payment records. */
export const toCustomerView = ({ adminNote: _a, payments: _p, ...o }: Order) => o

interface Line { product_id: string; variant_id: number | null; name: string; color: string; size: string; price: number; base_price: number; qty: number; image: string | null }

async function insertOrder(c: Client, o: Omit<OrderRow, 'id' | 'no' | 'token' | 'created_at' | 'updated_at' | 'admin_note'>, lines: Line[]) {
  const { rows } = await c.query<OrderRow>(
    `INSERT INTO orders (token, channel, customer_name, phone, ship, address, pay, card_type, note, items_total, discount_total, ship_fee, total, due_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [randomBytes(18).toString('base64url'), o.channel, o.customer_name, o.phone, o.ship, o.address, o.pay, o.card_type, o.note,
      o.items_total, o.discount_total, o.ship_fee, o.total, o.due_date, o.status],
  )
  for (const l of lines) {
    await c.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, name, color, size, price, base_price, qty, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [rows[0].id, l.product_id, l.variant_id, l.name, l.color, l.size, l.price, l.base_price, l.qty, l.image],
    )
  }
  await moveSaleStock(c, rows[0].id, -1)
  return rows[0]
}

/** Prices, discounts and the delivery fee always come from the database, never from the customer's browser. */
export async function createOrder(db: Db, input: OrderInput): Promise<Order> {
  const id = await tx(db, async c => {
    const ids = [...new Set(input.items.map(i => i.id))]
    const { rows: products } = await c.query<{
      id: string; category_id: string; name: string; price: number; colors: { n: string }[]; size_key: SizeKey; images: string[]; is_active: boolean; track_stock: boolean
    }>('SELECT id, category_id, name, price, colors, size_key, images, is_active, track_stock FROM products WHERE id = ANY($1)', [ids])
    const byId = new Map(products.map(p => [p.id, p]))
    const discounts = await activeDiscounts(c)

    const lines: Line[] = []
    for (const [index, it] of input.items.entries()) {
      const p = byId.get(it.id)
      if (!p || !p.is_active)
        throw new HttpError(409, 'Savatdagi bir mahsulot endi sotuvda yo‘q. Uni savatdan olib tashlang.', { index, id: it.id })
      const color = p.colors[it.ci]
      if (!color || !SIZES[p.size_key]?.includes(it.size))
        throw new HttpError(409, `«${p.name}» uchun tanlangan rang yoki o‘lcham endi yo‘q.`, { index, id: it.id })
      const v = await c.query<{ id: number; stock: number }>(
        'SELECT id, stock FROM variants WHERE product_id = $1 AND color = $2 AND size = $3 FOR UPDATE',
        [p.id, color.n, it.size],
      )
      const left = v.rows[0]?.stock ?? 0
      if (p.track_stock && left < it.qty)
        throw new HttpError(409, left > 0
          ? `«${p.name}» (${color.n}, ${it.size}) omborda faqat ${left} ta qoldi.`
          : `«${p.name}» (${color.n}, ${it.size}) tugagan. Uni savatdan olib tashlang.`, { index, id: it.id, left })
      const price = discounted(p.price, discountPercent({ id: p.id, cat: p.category_id }, discounts))
      lines.push({ product_id: p.id, variant_id: v.rows[0]?.id ?? null, name: p.name, color: color.n, size: it.size, price, base_price: p.price, qty: it.qty, image: p.images[0] ?? null })
    }

    const settings = await getSettings(c)
    const itemsTotal = lines.reduce((s, l) => s + l.price * l.qty, 0)
    const discountTotal = lines.reduce((s, l) => s + (l.base_price - l.price) * l.qty, 0)
    const shipFee = input.ship === 'pickup' || itemsTotal >= settings.freeFrom ? 0 : settings.shipFee
    const o = await insertOrder(c, {
      channel: 'online', customer_name: input.name, phone: `+998${input.phone}`, ship: input.ship,
      address: input.ship === 'pickup' ? '' : input.address, pay: input.pay,
      card_type: input.pay === 'card' ? (input.cardType ?? null) : null, note: input.note, items_total: itemsTotal,
      discount_total: discountTotal, ship_fee: shipFee, total: itemsTotal + shipFee, due_date: null, status: 'new',
    }, lines)
    return o.no
  })
  return findByNo(db, id)
}

const Method = z.enum(['cash', 'card'])

export const StoreSaleInput = z.object({
  items: z.array(z.object({ variantId: z.number().int().positive(), qty: z.number().int().min(1).max(100) })).min(1, 'Savdo bo‘sh: kiyimni skanerlang').max(100),
  customer: z.object({
    name: z.string().trim().max(60).default(''),
    phone: z.string().regex(/^(\d{9})?$/, 'Telefon raqamni to‘liq kiriting: 9 ta raqam').default(''),
  }).default({ name: '', phone: '' }),
  payments: z.array(z.object({ method: Method, amount: z.number().int().min(1) })).max(4).default([]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  note: z.string().trim().max(300).default(''),
})

/** A sale rung up at the till from scanned items. Whatever is not paid now stays as the customer's debt. */
export async function createStoreSale(db: Db, input: z.infer<typeof StoreSaleInput>): Promise<Order> {
  const no = await tx(db, async c => {
    const discounts = await activeDiscounts(c)
    const lines: Line[] = []
    for (const it of input.items) {
      const { rows } = await c.query<{ id: number; product_id: string; color: string; size: string; name: string; price: number; category_id: string; images: string[] }>(
        `SELECT v.id, v.product_id, v.color, v.size, p.name, p.price, p.category_id, p.images
         FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
        [it.variantId],
      )
      const v = rows[0]
      if (!v) throw new HttpError(404, 'Kiyim topilmadi')
      const price = discounted(v.price, discountPercent({ id: v.product_id, cat: v.category_id }, discounts))
      lines.push({ product_id: v.product_id, variant_id: v.id, name: v.name, color: v.color, size: v.size, price, base_price: v.price, qty: it.qty, image: v.images[0] ?? null })
    }
    const total = lines.reduce((s, l) => s + l.price * l.qty, 0)
    const paid = input.payments.reduce((s, p) => s + p.amount, 0)
    if (paid > total) throw new HttpError(400, 'To‘lov jami summadan oshib ketdi')
    const debtor = paid < total
    if (debtor && (input.customer.name.length < 2 || input.customer.phone.length !== 9))
      throw new HttpError(400, 'Nasiya yoki qisman to‘lovda mijozning ismi va telefonini kiriting')
    const methods = new Set(input.payments.map(p => p.method))
    const pay = paid === 0 ? 'credit' : methods.size > 1 ? 'mixed' : [...methods][0]

    const o = await insertOrder(c, {
      channel: 'store', customer_name: input.customer.name, phone: input.customer.phone ? `+998${input.customer.phone}` : '',
      ship: 'pickup', address: '', pay, card_type: null, note: input.note, items_total: total,
      discount_total: lines.reduce((s, l) => s + (l.base_price - l.price) * l.qty, 0), ship_fee: 0, total,
      due_date: debtor ? input.dueDate : null, status: 'done',
    }, lines)
    for (const p of input.payments) {
      await c.query('INSERT INTO payments (order_id, amount, method) VALUES ($1, $2, $3)', [o.id, p.amount, p.method])
    }
    return o.no
  })
  return findByNo(db, no)
}

export const PaymentInput = z.object({
  amount: z.number().int().min(1, 'Summani kiriting'),
  method: Method,
  note: z.string().trim().max(200).default(''),
})

/** Money that came in later: the rest of a partial payment, a debt instalment, or an online order paid on delivery. */
export async function addPayment(db: Db, no: number, p: z.infer<typeof PaymentInput>) {
  await tx(db, async c => {
    const { rows } = await c.query<OrderRow>('SELECT * FROM orders WHERE no = $1 FOR UPDATE', [no])
    const o = rows[0]
    if (!o) throw new HttpError(404, 'Savdo topilmadi')
    if (o.status === 'cancelled') throw new HttpError(409, 'Bekor qilingan savdoga to‘lov qo‘shib bo‘lmaydi')
    const paid = (await c.query<{ s: number }>('SELECT coalesce(sum(amount), 0)::int AS s FROM payments WHERE order_id = $1', [o.id])).rows[0].s
    const debt = o.total - paid
    if (debt <= 0) throw new HttpError(409, 'Bu savdo to‘liq to‘langan')
    if (p.amount > debt) throw new HttpError(400, `Qolgan qarz ${money(debt)}. Undan ko‘p to‘lov qo‘shib bo‘lmaydi.`)
    await c.query('INSERT INTO payments (order_id, amount, method, note) VALUES ($1, $2, $3, $4)', [o.id, p.amount, p.method, p.note])
  })
  return findByNo(db, no)
}

async function withDetails(db: Client, orders: OrderRow[]): Promise<Order[]> {
  if (!orders.length) return []
  const ids = orders.map(o => o.id)
  const [items, payments] = await Promise.all([
    db.query<ItemRow>('SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY id', [ids]),
    db.query<PaymentRow>('SELECT * FROM payments WHERE order_id = ANY($1) ORDER BY created_at, id', [ids]),
  ])
  return orders.map(o => toOrder(o, items.rows.filter(i => i.order_id === o.id), payments.rows.filter(p => p.order_id === o.id)))
}

export async function findByTokens(db: Client, tokens: string[]) {
  const { rows } = await db.query<OrderRow>("SELECT * FROM orders WHERE token = ANY($1) AND channel = 'online' ORDER BY created_at DESC", [tokens])
  return withDetails(db, rows)
}

export async function findByNo(db: Client, no: number) {
  const { rows } = await db.query<OrderRow>('SELECT * FROM orders WHERE no = $1', [no])
  if (!rows[0]) throw new HttpError(404, 'Buyurtma topilmadi')
  return (await withDetails(db, rows))[0]
}

export const OrderQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  channel: z.enum(['online', 'store']).optional(),
  pay: z.enum(['paid', 'partial', 'unpaid', 'debt']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

export async function listOrders(db: Client, f: z.infer<typeof OrderQuery>) {
  const text = f.q?.trim() || null
  const digits = text?.replace(/\D/g, '') ?? ''
  const limit = 50
  const { rows } = await db.query<OrderRow>(
    `SELECT o.* FROM orders o
     CROSS JOIN LATERAL (SELECT coalesce(sum(amount), 0)::int AS paid FROM payments WHERE order_id = o.id) p
     WHERE ($1::text IS NULL OR o.status = $1)
       AND ($2::text IS NULL OR o.channel = $2)
       AND ($3::text IS NULL
            OR ($3 = 'paid' AND p.paid >= o.total)
            OR ($3 = 'partial' AND p.paid > 0 AND p.paid < o.total)
            OR ($3 = 'unpaid' AND p.paid = 0)
            OR ($3 = 'debt' AND p.paid < o.total AND o.status <> 'cancelled' AND (o.channel = 'store' OR o.status = 'done')))
       AND ($4::timestamptz IS NULL OR o.created_at >= $4)
       AND ($5::timestamptz IS NULL OR o.created_at < $5)
       AND ($6::text IS NULL
            OR o.customer_name ILIKE '%' || $6 || '%'
            OR ($7 <> '' AND (o.no::text = $7 OR o.phone LIKE '%' || $7 || '%')))
     ORDER BY o.created_at DESC LIMIT $8 OFFSET $9`,
    [f.status ?? null, f.channel ?? null, f.pay ?? null, f.from ?? null, f.to ?? null, text, digits, limit, (f.page - 1) * limit],
  )
  const counts = await db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM orders WHERE channel = 'online' GROUP BY status")
  return { orders: await withDetails(db, rows), counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])) }
}

export const OrderPatch = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  adminNote: z.string().trim().max(1000).optional(),
})

/** Cancelling puts the items back on the shelf; un-cancelling takes them off again. */
export async function updateOrder(db: Db, no: number, patch: z.infer<typeof OrderPatch>) {
  await tx(db, async c => {
    const { rows } = await c.query<OrderRow>('SELECT * FROM orders WHERE no = $1 FOR UPDATE', [no])
    const o = rows[0]
    if (!o) throw new HttpError(404, 'Buyurtma topilmadi')
    if (patch.status && patch.status !== o.status) {
      if (patch.status === 'cancelled') await moveSaleStock(c, o.id, 1)
      else if (o.status === 'cancelled') await moveSaleStock(c, o.id, -1)
    }
    await c.query(
      'UPDATE orders SET status = coalesce($2, status), admin_note = coalesce($3, admin_note), updated_at = now() WHERE id = $1',
      [o.id, patch.status ?? null, patch.adminNote ?? null],
    )
  })
  return findByNo(db, no)
}
