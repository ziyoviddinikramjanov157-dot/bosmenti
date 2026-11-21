import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { checkCredentials, COOKIE, cookieOptions, createSession, destroySession, requireAdmin } from '../auth.js'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import { HttpError } from '../errors.js'
import { addPayment, createStoreSale, findByNo, listOrders, OrderPatch, OrderQuery, PaymentInput, StoreSaleInput, updateOrder } from '../services/orders.js'
import { createDiscount, deleteDiscount, DiscountInput, listDiscounts } from '../services/pricing.js'
import { createProduct, deleteProduct, listProducts, ProductInput, setTracking, updateProduct } from '../services/products.js'
import { report, ReportQuery } from '../services/report.js'
import { getSettings, saveSettings, Settings } from '../services/settings.js'
import { AdjustInput, adjustStock, BindInput, bindCode, intake, IntakeInput, labels, LabelsInput, lookupCode, stockList, stockMoves, VariantInput, variantInfo } from '../services/stock.js'
import { saveImage, uploadMiddleware } from '../uploads.js'

const orderNo = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Buyurtma topilmadi')
  return n
}

export function adminRouter({ db, cfg, rateLimits }: { db: Db; cfg: Config; rateLimits: boolean }) {
  const r = Router()

  const Login = z.object({ login: z.string().max(100), password: z.string().max(200) })
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.' },
  })

  r.post('/login', rateLimits ? loginLimit : (_req, _res, next) => next(), async (req, res) => {
    const { login, password } = Login.parse(req.body)
    if (!checkCredentials(cfg, login, password)) throw new HttpError(401, 'Login yoki parol noto‘g‘ri')
    res.cookie(COOKIE, await createSession(db), cookieOptions(cfg))
    res.json({ login: cfg.ADMIN_LOGIN })
  })

  r.post('/logout', async (req, res) => {
    await destroySession(db, req.cookies?.[COOKIE])
    res.clearCookie(COOKIE, { ...cookieOptions(cfg), maxAge: undefined })
    res.json({ ok: true })
  })

  r.use(requireAdmin(db))

  r.get('/me', (_req, res) => {
    res.json({ login: cfg.ADMIN_LOGIN })
  })

  r.get('/orders', async (req, res) => {
    res.json(await listOrders(db, OrderQuery.parse(req.query)))
  })

  r.get('/orders/:no', async (req, res) => {
    res.json(await findByNo(db, orderNo(req.params.no)))
  })

  r.patch('/orders/:no', async (req, res) => {
    res.json(await updateOrder(db, orderNo(req.params.no), OrderPatch.parse(req.body)))
  })

  r.post('/orders/:no/payments', async (req, res) => {
    res.status(201).json(await addPayment(db, orderNo(req.params.no), PaymentInput.parse(req.body)))
  })

  // the till
  r.post('/sales', async (req, res) => {
    res.status(201).json(await createStoreSale(db, StoreSaleInput.parse(req.body)))
  })

  r.get('/lookup', async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(64) }).parse(req.query)
    res.json(await lookupCode(db, code))
  })

  r.post('/variants', async (req, res) => {
    res.json(await variantInfo(db, VariantInput.parse(req.body)))
  })

  r.post('/barcodes', async (req, res) => {
    res.status(201).json(await bindCode(db, BindInput.parse(req.body)))
  })

  r.post('/intake', async (req, res) => {
    res.status(201).json(await intake(db, IntakeInput.parse(req.body)))
  })

  r.get('/stock', async (_req, res) => {
    res.json({ products: await stockList(db) })
  })

  r.post('/stock/adjust', async (req, res) => {
    res.json(await adjustStock(db, AdjustInput.parse(req.body)))
  })

  r.post('/stock/tracking', async (req, res) => {
    const { productId, on } = z.object({ productId: z.string().min(1), on: z.boolean() }).parse(req.body)
    await setTracking(db, productId, on)
    res.json({ ok: true })
  })

  r.get('/stock/moves', async (req, res) => {
    const q = z.object({
      reason: z.enum(['intake', 'sale', 'cancel', 'adjust']).optional(),
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
    }).parse(req.query)
    res.json({ moves: await stockMoves(db, q) })
  })

  r.post('/labels', async (req, res) => {
    res.json({ labels: await labels(db, LabelsInput.parse(req.body)) })
  })

  r.get('/discounts', async (_req, res) => {
    res.json({ discounts: await listDiscounts(db) })
  })

  r.post('/discounts', async (req, res) => {
    res.status(201).json(await createDiscount(db, DiscountInput.parse(req.body)))
  })

  r.delete('/discounts/:id', async (req, res) => {
    await deleteDiscount(db, z.coerce.number().int().positive().parse(req.params.id))
    res.status(204).end()
  })

  r.get('/report', async (req, res) => {
    const { from, to } = ReportQuery.parse(req.query)
    res.json(await report(db, from, to))
  })

  r.get('/products', async (_req, res) => {
    res.json({ products: await listProducts(db, { includeInactive: true }) })
  })

  r.post('/products', async (req, res) => {
    res.status(201).json(await createProduct(db, ProductInput.parse(req.body)))
  })

  r.put('/products/:id', async (req, res) => {
    res.json(await updateProduct(db, req.params.id, ProductInput.parse(req.body)))
  })

  r.delete('/products/:id', async (req, res) => {
    await deleteProduct(db, req.params.id)
    res.status(204).end()
  })

  r.post('/uploads', uploadMiddleware, async (req, res) => {
    res.status(201).json({ url: await saveImage(cfg.UPLOAD_DIR, req.file) })
  })

  r.get('/settings', async (_req, res) => {
    res.json(await getSettings(db))
  })

  r.put('/settings', async (req, res) => {
    const s = Settings.parse(req.body)
    await saveSettings(db, s)
    res.json(s)
  })

  return r
}
