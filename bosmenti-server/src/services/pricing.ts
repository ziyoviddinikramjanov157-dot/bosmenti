import { z } from 'zod'
import type { Client } from '../db.js'
import { HttpError } from '../errors.js'

export { discounted, discountPercent, ean13ForVariant, isActive, type Discount } from '../pos-rules.js'
import { isActive, type Discount } from '../pos-rules.js'

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
