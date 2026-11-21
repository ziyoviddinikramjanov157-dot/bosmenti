import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ean13ForVariant } from '../src/services/pricing.js'
import { ADMIN, close, order, setup } from './helpers.js'

let ctx: Awaited<ReturnType<typeof setup>>
let admin: ReturnType<typeof request.agent>
beforeEach(async () => {
  if (ctx) await close(ctx.db)
  ctx = await setup()
  admin = request.agent(ctx.app)
  await admin.post('/api/admin/login').send(ADMIN).expect(200)
})
afterAll(() => close(ctx.db))

/** Prints one label for a colour/size and returns its variant id and code. */
const label = async (productId: string, color: string, size: string) => {
  const res = await admin.post('/api/admin/labels').send({ items: [{ productId, color, size, copies: 1 }] }).expect(200)
  const code = res.body.labels[0].code
  const found = await admin.get('/api/admin/lookup').query({ code }).expect(200)
  return { code, variantId: found.body.variant.id as number }
}
const stockOf = async (variantId: number) => {
  const { rows } = await ctx.db.query('SELECT stock FROM variants WHERE id = $1', [variantId])
  return rows[0].stock as number
}

describe('barcodes', () => {
  it('prints labels with the shop’s own EAN-13 codes that the till recognises', async () => {
    const res = await admin.post('/api/admin/labels').send({ items: [{ productId: 'tee', color: 'Oq', size: 'M', copies: 3 }] }).expect(200)
    expect(res.body.labels[0]).toMatchObject({ name: 'Basic futbolka', color: 'Oq', size: 'M', price: 129000, copies: 3 })
    expect(res.body.labels[0].code).toMatch(/^200\d{10}$/)
    expect(ean13ForVariant(1)).toBe('2000000000015')

    const found = await admin.get('/api/admin/lookup').query({ code: res.body.labels[0].code }).expect(200)
    expect(found.body).toMatchObject({ variant: { color: 'Oq', size: 'M', stock: 0 }, product: { id: 'tee', price: 129000 } })
    const unknown = await admin.get('/api/admin/lookup').query({ code: '4780000000001' }).expect(404)
    expect(unknown.body.details).toEqual({ code: '4780000000001' })
  })

  it('binds a supplier’s code to a colour and size once', async () => {
    await admin.post('/api/admin/barcodes').send({ code: '4780000000001', productId: 'jeans', color: 'Ko‘k', size: '50' }).expect(201)
    const found = await admin.get('/api/admin/lookup').query({ code: '4780000000001' }).expect(200)
    expect(found.body.variant).toMatchObject({ productId: 'jeans', color: 'Ko‘k', size: '50' })
    await admin.post('/api/admin/barcodes').send({ code: '4780000000001', productId: 'jeans', color: 'Qora', size: '50' }).expect(409)
    await admin.post('/api/admin/barcodes').send({ code: '4780000000002', productId: 'jeans', color: 'Pushti', size: '50' }).expect(400)
    await admin.post('/api/admin/barcodes').send({ code: '4780000000003', productId: 'jeans', color: 'Qora', size: 'XL' }).expect(400)
  })

  it('finds a colour and size picked by hand, with its current price', async () => {
    const res = await admin.post('/api/admin/variants').send({ productId: 'chino', color: 'Xaki', size: '50' }).expect(200)
    expect(res.body).toMatchObject({ variant: { productId: 'chino', color: 'Xaki', size: '50', stock: 0 }, product: { name: 'Chino shim', price: 299000 } })
    await admin.post('/api/admin/variants').send({ productId: 'chino', color: 'Xaki', size: 'M' }).expect(400)
  })
})

describe('stock', () => {
  it('intake raises stock, the shop then refuses to sell more online than is left, and cancelling returns it', async () => {
    const { variantId } = await label('tee', 'Oq', 'M')
    await admin.post('/api/admin/intake').send({ lines: [{ variantId, qty: 3 }], note: 'Yetkazib beruvchi: Ali' }).expect(201)
    expect(await stockOf(variantId)).toBe(3)

    const catalog = await request(ctx.app).get('/api/catalog')
    const tee = catalog.body.products.find((p: { id: string }) => p.id === 'tee')
    expect(tee.stock).toEqual({ 'Oq|M': 3 })
    expect(catalog.body.products.find((p: { id: string }) => p.id === 'jeans').stock).toBeUndefined()

    const tooMany = await request(ctx.app).post('/api/orders').send(order({ items: [{ id: 'tee', ci: 0, size: 'M', qty: 4 }] })).expect(409)
    expect(tooMany.body.error).toContain('faqat 3 ta qoldi')
    await request(ctx.app).post('/api/orders').send(order({ items: [{ id: 'tee', ci: 0, size: 'L', qty: 1 }] })).expect(409)

    const placed = await request(ctx.app).post('/api/orders').send(order({ items: [{ id: 'tee', ci: 0, size: 'M', qty: 2 }] })).expect(201)
    expect(await stockOf(variantId)).toBe(1)
    await admin.patch(`/api/admin/orders/${placed.body.no}`).send({ status: 'cancelled' }).expect(200)
    expect(await stockOf(variantId)).toBe(3)

    const moves = await admin.get('/api/admin/stock/moves').expect(200)
    expect(moves.body.moves.map((m: { reason: string; qty: number }) => [m.reason, m.qty])).toEqual([['cancel', 2], ['sale', -2], ['intake', 3]])
  })

  it('a recount sets the exact number and can switch tracking off', async () => {
    const { variantId } = await label('belt', 'Qora', '115')
    await admin.post('/api/admin/stock/adjust').send({ variantId, stock: 7, note: 'Sanoq' }).expect(200)
    expect(await stockOf(variantId)).toBe(7)
    const list = await admin.get('/api/admin/stock').expect(200)
    const belt = list.body.products.find((p: { id: string }) => p.id === 'belt')
    expect(belt.variants[0]).toMatchObject({ color: 'Qora', size: '115', stock: 7 })
    expect(belt.variants[0].codes).toHaveLength(1)
    await admin.post('/api/admin/stock/tracking').send({ productId: 'belt', on: true }).expect(200)
    expect((await request(ctx.app).get('/api/catalog')).body.products.find((p: { id: string }) => p.id === 'belt').stock).toEqual({ 'Qora|115': 7 })
  })
})

describe('the till', () => {
  it('sells for cash and takes the items off the shelf', async () => {
    const { variantId } = await label('tee', 'Oq', 'M')
    await admin.post('/api/admin/intake').send({ lines: [{ variantId, qty: 5 }] }).expect(201)
    const sale = await admin.post('/api/admin/sales').send({ items: [{ variantId, qty: 2 }], payments: [{ method: 'cash', amount: 258000 }] }).expect(201)
    expect(sale.body).toMatchObject({ channel: 'store', status: 'done', total: 258000, paid: 258000, debt: 0, payState: 'paid', pay: 'cash', shipFee: 0 })
    expect(sale.body.payments).toHaveLength(1)
    expect(await stockOf(variantId)).toBe(3)
  })

  it('keeps the unpaid part as the customer’s debt until they bring the rest', async () => {
    const { variantId } = await label('jeans', 'Qora', '50')
    const sale = { items: [{ variantId, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] }
    const noName = await admin.post('/api/admin/sales').send(sale).expect(400)
    expect(noName.body.error).toBe('Nasiya yoki qisman to‘lovda mijozning ismi va telefonini kiriting')

    const res = await admin.post('/api/admin/sales').send({ ...sale, customer: { name: 'Bekzod', phone: '931112233' }, dueDate: '2026-12-15' }).expect(201)
    expect(res.body).toMatchObject({ total: 379000, paid: 100000, debt: 279000, payState: 'partial', dueDate: '2026-12-15', phone: '+998931112233' })

    await admin.post(`/api/admin/orders/${res.body.no}/payments`).send({ amount: 300000, method: 'card' }).expect(400)
    const paid = await admin.post(`/api/admin/orders/${res.body.no}/payments`).send({ amount: 279000, method: 'card' }).expect(201)
    expect(paid.body).toMatchObject({ debt: 0, payState: 'paid' })
    expect(paid.body.payments.map((p: { method: string; amount: number }) => [p.method, p.amount])).toEqual([['cash', 100000], ['card', 279000]])
    await admin.post(`/api/admin/orders/${res.body.no}/payments`).send({ amount: 1000, method: 'cash' }).expect(409)
  })

  it('sells fully on credit (nasiya) and refuses to take more than the total', async () => {
    const { variantId } = await label('belt', 'Qora', '115')
    const credit = await admin.post('/api/admin/sales').send({ items: [{ variantId, qty: 1 }], customer: { name: 'Dilshod', phone: '901234567' } }).expect(201)
    expect(credit.body).toMatchObject({ pay: 'credit', paid: 0, debt: 149000, payState: 'unpaid' })
    await admin.post('/api/admin/sales').send({ items: [{ variantId, qty: 1 }], payments: [{ method: 'cash', amount: 200000 }] }).expect(400)

    const debts = await admin.get('/api/admin/orders').query({ pay: 'debt' }).expect(200)
    expect(debts.body.orders.map((o: { name: string }) => o.name)).toEqual(['Dilshod'])
  })
})

describe('discounts', () => {
  it('applies the biggest active discount to the shop, the till and orders', async () => {
    await admin.post('/api/admin/discounts').send({ scope: 'category', targetId: 'futbolka', percent: 20 }).expect(201)
    const own = await admin.post('/api/admin/discounts').send({ scope: 'product', targetId: 'tee', percent: 30 }).expect(201)
    await admin.post('/api/admin/discounts').send({ scope: 'product', targetId: 'oversize', percent: 50, endsAt: '2020-01-01T00:00:00Z' }).expect(201)

    const catalog = await request(ctx.app).get('/api/catalog')
    const find = (id: string) => catalog.body.products.find((p: { id: string }) => p.id === id)
    expect(find('tee')).toMatchObject({ price: 90300, old: 129000, tag: '-30%', discount: 30 })
    expect(find('oversize')).toMatchObject({ price: 135200, old: 169000, discount: 20 })

    const placed = await request(ctx.app).post('/api/orders').send(order({ items: [{ id: 'tee', ci: 0, size: 'M', qty: 2 }] })).expect(201)
    expect(placed.body).toMatchObject({ itemsTotal: 180600, discountTotal: 77400 })
    expect(placed.body.items[0]).toMatchObject({ price: 90300, basePrice: 129000 })

    const { variantId } = await label('tee', 'Qora', 'L')
    const sale = await admin.post('/api/admin/sales').send({ items: [{ variantId, qty: 1 }], payments: [{ method: 'card', amount: 90300 }] }).expect(201)
    expect(sale.body.total).toBe(90300)

    await admin.delete(`/api/admin/discounts/${own.body.id}`).expect(204)
    expect((await request(ctx.app).get('/api/catalog')).body.products.find((p: { id: string }) => p.id === 'tee').price).toBe(103200)
    await admin.post('/api/admin/discounts').send({ scope: 'category', targetId: 'yoq', percent: 10 }).expect(400)
    await admin.post('/api/admin/discounts').send({ scope: 'product', targetId: 'tee', percent: 95 }).expect(400)
  })
})

describe('report', () => {
  it('splits sales by store and website, money by cash and card, and lists debtors', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString(), to = new Date(Date.now() + 3600_000).toISOString()
    const { variantId } = await label('belt', 'Jigarrang', '105')
    await admin.post('/api/admin/sales').send({ items: [{ variantId, qty: 2 }], payments: [{ method: 'cash', amount: 298000 }] }).expect(201)
    await admin.post('/api/admin/sales').send({
      items: [{ variantId, qty: 1 }], payments: [{ method: 'card', amount: 49000 }], customer: { name: 'Bekzod', phone: '931112233' }, dueDate: '2026-12-01',
    }).expect(201)
    const online = await request(ctx.app).post('/api/orders').send(order()).expect(201)
    const delivered = await request(ctx.app).post('/api/orders').send(order({ name: 'Sardor' })).expect(201)
    await admin.patch(`/api/admin/orders/${delivered.body.no}`).send({ status: 'done' }).expect(200)

    const r = (await admin.get('/api/admin/report').query({ from, to }).expect(200)).body
    expect(r.sales).toEqual({
      store: { count: 2, total: 447000, discount: 0 },
      online: { count: 2, total: 2 * 283000, discount: 0 },
    })
    expect(r.money).toEqual({ cash: { count: 1, amount: 298000 }, card: { count: 1, amount: 49000 } })
    expect(r.debts.list.map((d: { name: string; debt: number }) => [d.name, d.debt])).toEqual([['Bekzod', 100000], ['Sardor', 283000]])
    expect(r.debts.total).toBe(383000)
    expect(r.pendingOnline).toEqual({ count: 1, amount: 283000 })
    expect(r.top.map((t: { productId: string; qty: number }) => [t.productId, t.qty])).toEqual([['tee', 4], ['belt', 3]])
    expect(online.body.status).toBe('new')
  })
})
