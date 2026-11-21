import { z } from 'zod'
import type { Client } from '../db.js'

export const ReportQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
})

/**
 * Sales are counted by the day they were made, money by the day it came in: a debt paid this week counts in this
 * week's cash even if the sale was last month. Online orders that are not delivered yet are not debts.
 */
export async function report(db: Client, from: string, to: string) {
  const range = [from, to]
  const [sales, money, debts, pending, top] = await Promise.all([
    db.query<{ channel: 'online' | 'store'; n: number; total: number; discount: number }>(
      `SELECT channel, count(*)::int AS n, coalesce(sum(total), 0)::int AS total, coalesce(sum(discount_total), 0)::int AS discount
       FROM orders WHERE status <> 'cancelled' AND created_at >= $1 AND created_at < $2 GROUP BY channel`,
      range,
    ),
    db.query<{ method: 'cash' | 'card'; n: number; amount: number }>(
      `SELECT p.method, count(*)::int AS n, coalesce(sum(p.amount), 0)::int AS amount
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.status <> 'cancelled' AND p.created_at >= $1 AND p.created_at < $2 GROUP BY p.method`,
      range,
    ),
    db.query<{ no: number; channel: string; customer_name: string; phone: string; total: number; paid: number; created_at: Date; due_date: string | null }>(
      `SELECT o.no, o.channel, o.customer_name, o.phone, o.total, o.created_at, o.due_date, coalesce(sum(p.amount), 0)::int AS paid
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.status <> 'cancelled' AND (o.channel = 'store' OR o.status = 'done')
       GROUP BY o.id HAVING coalesce(sum(p.amount), 0) < o.total
       ORDER BY o.due_date NULLS LAST, o.created_at`,
    ),
    db.query<{ n: number; amount: number }>(
      `SELECT count(*)::int AS n, coalesce(sum(o.total - coalesce(p.paid, 0)), 0)::int AS amount
       FROM orders o LEFT JOIN (SELECT order_id, sum(amount) AS paid FROM payments GROUP BY order_id) p ON p.order_id = o.id
       WHERE o.channel = 'online' AND o.status NOT IN ('done', 'cancelled') AND coalesce(p.paid, 0) < o.total`,
    ),
    db.query<{ product_id: string; name: string; qty: number; amount: number }>(
      `SELECT i.product_id, i.name, sum(i.qty)::int AS qty, sum(i.price * i.qty)::int AS amount
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status <> 'cancelled' AND o.created_at >= $1 AND o.created_at < $2
       GROUP BY i.product_id, i.name ORDER BY qty DESC, amount DESC LIMIT 10`,
      range,
    ),
  ])

  const channel = (c: 'online' | 'store') => {
    const r = sales.rows.find(x => x.channel === c)
    return { count: r?.n ?? 0, total: r?.total ?? 0, discount: r?.discount ?? 0 }
  }
  const method = (m: 'cash' | 'card') => {
    const r = money.rows.find(x => x.method === m)
    return { count: r?.n ?? 0, amount: r?.amount ?? 0 }
  }
  const debtList = debts.rows.map(d => ({
    no: d.no, channel: d.channel, name: d.customer_name, phone: d.phone, total: d.total, paid: d.paid,
    debt: d.total - d.paid, createdAt: d.created_at.toISOString(), dueDate: d.due_date,
  }))
  return {
    from, to,
    sales: { store: channel('store'), online: channel('online') },
    money: { cash: method('cash'), card: method('card') },
    debts: { total: debtList.reduce((s, d) => s + d.debt, 0), list: debtList },
    pendingOnline: { count: pending.rows[0].n, amount: pending.rows[0].amount },
    top: top.rows.map(t => ({ productId: t.product_id, name: t.name, qty: t.qty, amount: t.amount })),
  }
}
