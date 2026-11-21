import { z } from 'zod'
import type { Client } from '../db.js'
import { HttpError } from '../errors.js'

export interface Discount {
  id: number
  scope: 'product' | 'category'
  targetId: string
  percent: number
  startsAt: string | null
  endsAt: string | null
}

/* Pure helpers: also used by the in-browser preview. */

export const isActive = (d: Discount, now: Date) =>
  (!d.startsAt || new Date(d.startsAt) <= now) && (!d.endsAt || new Date(d.endsAt) > now)

/** The biggest active discount for a product, from its own and its category's discounts. */
export const discountPercent = (p: { id: string; cat: string }, discounts: Discount[], now = new Date()) =>
  discounts
    .filter(d => isActive(d, now) && (d.scope === 'product' ? d.targetId === p.id : d.targetId === p.cat))
    .reduce((max, d) => Math.max(max, d.percent), 0)

/** Price after a percent discount, rounded to the nearest 100 so‘m. */
export const discounted = (price: number, percent: number) =>
  percent ? Math.round((price * (100 - percent)) / 10000) * 100 : price

/** "Internal use" EAN-13 code (prefix 200) for our own labels: digits only, so the scanner types it the same on any keyboard layout. */
export function ean13ForVariant(variantId: number) {
  const body = `200${String(variantId).padStart(9, '0')}`
  const sum = [...body].reduce((s, ch, i) => s + Number(ch) * (i % 2 ? 3 : 1), 0)
  return body + ((10 - (sum % 10)) % 10)
}

/* Database */

interface DiscountRow { id: number; scope: Discount['scope']; target_id: string; percent: number; starts_at: Date | null; ends_at: Date | null }
const toDiscount = (r: DiscountRow): Discount => ({
  id: r.id, scope: r.scope, targetId: r.target_id, percent: r.percent,
  startsAt: r.starts_at?.toISOString() ?? null, endsAt: r.ends_at?.toISOString() ?? null,
})

export async function listDiscounts(db: Client) {
  const { rows } = await db.query<DiscountRow>('SELECT * FROM discounts ORDER BY created_at DESC')
  return rows.map(toDiscount)
}

export async function activeDiscounts(db: Client, now = new Date()) {
  return (await listDiscounts(db)).filter(d => isActive(d, now))
}

export const DiscountInput = z
  .object({
    scope: z.enum(['product', 'category']),
    targetId: z.string().min(1, 'Mahsulot yoki bo‘limni tanlang'),
    percent: z.number().int().min(1, 'Chegirma 1% dan kam bo‘lmasin').max(90, 'Chegirma 90% dan oshmasin'),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .refine(d => !d.startsAt || !d.endsAt || d.startsAt < d.endsAt, { message: 'Tugash vaqti boshlanishidan keyin bo‘lsin', path: ['endsAt'] })

export async function createDiscount(db: Client, d: z.infer<typeof DiscountInput>) {
  const table = d.scope === 'product' ? 'products' : 'categories'
  const { rowCount } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [d.targetId])
  if (!rowCount) throw new HttpError(400, d.scope === 'product' ? 'Mahsulot topilmadi' : 'Bunday bo‘lim yo‘q')
  const { rows } = await db.query<DiscountRow>(
    'INSERT INTO discounts (scope, target_id, percent, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [d.scope, d.targetId, d.percent, d.startsAt, d.endsAt],
  )
  return toDiscount(rows[0])
}

export async function deleteDiscount(db: Client, id: number) {
  const { rowCount } = await db.query('DELETE FROM discounts WHERE id = $1', [id])
  if (!rowCount) throw new HttpError(404, 'Chegirma topilmadi')
}
