import { api, ApiError } from '../lib/api'

export const LOGGED_OUT = 'bosmenti-admin:logged-out'

/** Like api(), but an expired session sends the admin back to the login screen. */
export async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await api<T>(path, init)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !path.endsWith('/login')) dispatchEvent(new Event(LOGGED_OUT))
    throw e
  }
}

export const send = <T>(method: string, path: string, data?: unknown) =>
  adminApi<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) })

export type Status = 'new' | 'confirmed' | 'shipping' | 'done' | 'cancelled'
export type PayState = 'paid' | 'partial' | 'unpaid'

export const STATUS: Record<Status, string> = {
  new: 'Yangi',
  confirmed: 'Tasdiqlangan',
  shipping: 'Yo‘lda',
  done: 'Topshirilgan',
  cancelled: 'Bekor qilingan',
}

export const PAY_STATE: Record<PayState, string> = { paid: 'To‘langan', partial: 'Qisman', unpaid: 'To‘lanmagan' }

export interface Payment { id: number; amount: number; method: 'cash' | 'card'; note: string; createdAt: string }

export interface AdminOrder {
  no: number
  channel: 'online' | 'store'
  name: string
  phone: string
  ship: 'delivery' | 'pickup'
  address: string
  pay: 'cash' | 'card' | 'mixed' | 'credit'
  cardType: string | null
  note: string
  itemsTotal: number
  discountTotal: number
  shipFee: number
  total: number
  paid: number
  debt: number
  payState: PayState
  dueDate: string | null
  status: Status
  adminNote: string
  createdAt: string
  items: { productId: string; name: string; color: string; size: string; price: number; basePrice: number; qty: number; image: string | null }[]
  payments: Payment[]
}

export interface AdminProduct {
  id: string
  cat: string
  name: string
  price: number
  old: number
  imgs: string[]
  type: string
  colors: { n: string; c: string }[]
  sz: string
  mat: string
  made: string
  tag: string
  desc: string
  acc: string | null
  isNew: boolean
  active: boolean
  sort: number
  track?: boolean
}

export interface Settings {
  phone: string
  address: string
  hours: string
  shipFee: number
  freeFrom: number
  cardNumber: string
  cardOwner: string
  receiptWidth: 58 | 80
}

/** A colour/size of a product with its current price, as the till and intake screens use it. */
export interface Found {
  code?: string
  variant: { id: number; productId: string; color: string; size: string; stock: number }
  product: { id: string; name: string; basePrice: number; price: number; discount: number; image: string | null }
}

export interface StockProduct {
  id: string
  name: string
  cat: string
  price: number
  colors: { n: string; c: string }[]
  sizes: string[]
  image: string | null
  track: boolean
  active: boolean
  variants: { id: number; color: string; size: string; stock: number; codes: string[] }[]
}

export interface Discount {
  id: number
  scope: 'product' | 'category'
  targetId: string
  percent: number
  startsAt: string | null
  endsAt: string | null
}

export interface Label { code: string; name: string; color: string; size: string; price: number; copies: number }

/** Everything the screens need to pick a product, colour and size by hand. */
export interface Catalog {
  categories: { id: string; name: string }[]
  products: { id: string; cat: string; name: string; colors: { n: string; c: string }[]; sz: string }[]
  sizes: Record<string, string[]>
  shop: Settings
}

export const loadCatalog = () => api<Catalog>('/api/catalog')
