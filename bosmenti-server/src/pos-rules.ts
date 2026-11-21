/* Pure rules with no server dependencies, shared with the in-browser preview of the admin panel. */

export interface Discount {
  id: number
  scope: 'product' | 'category'
  targetId: string
  percent: number
  startsAt: string | null
  endsAt: string | null
}

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

export type PayState = 'paid' | 'partial' | 'unpaid'
export const payState = (total: number, paid: number): PayState => (paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid')
