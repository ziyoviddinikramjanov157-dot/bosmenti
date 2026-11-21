import type { ArtType } from '../lib/art'
import { api } from '../lib/api'

/* The catalogue comes from the server once, when the site opens. These bindings are filled by loadCatalog()
   before the shop renders, so screens can keep reading them synchronously. */

export type CatId = string
export type SizeKey = 'top' | 'pants' | 'doppi' | 'shoes' | 'under' | 'belt' | 'socks'

export interface Category { id: CatId; name: string; type: ArtType; c: string }
export interface Color { n: string; c: string }
export interface Product {
  id: string
  cat: CatId
  name: string
  price: number
  old: number
  imgs: string[]
  type: ArtType
  colors: Color[]
  sz: SizeKey
  mat: string
  made: string
  tag: string
  desc: string
  acc?: string
  isNew: boolean
  tint: string
  /** Pieces left per "colour|size"; only for products whose stock the shop tracks */
  stock?: Record<string, number>
  discount?: number
}
export interface Shop { phone: string; address: string; hours: string; shipFee: number; freeFrom: number; cardNumber: string; cardOwner: string }

export const TINT = ['#E4E7E1', '#E9E3D8', '#DCE3E8', '#E7E0DE', '#E1E6DB', '#EAE6DE']

export let CATS: Category[] = []
export let CN: Record<CatId, string> = {}
export let PRODUCTS: Product[] = []
export let SIZES = {} as Record<SizeKey, string[]>
export let GUIDE = {} as Record<SizeKey, { h: string[]; r: string[][] }>
export let SHOP: Shop = { phone: '', address: '', hours: '', shipFee: 0, freeFrom: 0, cardNumber: '', cardOwner: '' }
export let NEW_ARRIVALS: string[] = []

interface CatalogResponse {
  categories: Category[]
  products: (Omit<Product, 'tint' | 'acc'> & { acc: string | null })[]
  sizes: typeof SIZES
  guide: typeof GUIDE
  shop: Shop
}

export async function loadCatalog() {
  const d = await api<CatalogResponse>('/api/catalog')
  CATS = d.categories
  CN = Object.fromEntries(CATS.map(c => [c.id, c.name]))
  PRODUCTS = d.products.map((p, i) => ({ ...p, acc: p.acc ?? undefined, tint: TINT[i % TINT.length] }))
  SIZES = d.sizes
  GUIDE = d.guide
  SHOP = d.shop
  NEW_ARRIVALS = PRODUCTS.filter(p => p.isNew).map(p => p.id)
}

export const byId = (id: string | null) => PRODUCTS.find(p => p.id === id)

/** Pieces left of a colour and size; unlimited when the shop does not track this product's stock. */
export const leftOf = (p: Product, color: string, size: string) => (p.stock ? p.stock[`${color}|${size}`] ?? 0 : Infinity)
export const soldOut = (p: Product) => !!p.stock && Object.values(p.stock).every(n => n <= 0)
/** "8600123412341234" -> "8600 1234 1234 1234" */
export const cardShown = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ')

/** Landing: collection cards → shop category */
export const COLLECTIONS: { t: string; s: string; img: string; cat: CatId }[] = [
  { t: 'Klassika', s: 'Kostyum, ko‘ylak, shim', img: 'c-classic', cat: 'kostyum' },
  { t: 'Kundalik', s: 'Futbolka, jinsi, chino', img: 'c-casual', cat: 'jinsi' },
  { t: 'Kuz-qish', s: 'Kurtka va sviterlar', img: 'c-autumn', cat: 'kurtka' },
  { t: 'Poyabzal', s: 'Tufli, botinka, krossovka', img: 'c-shoes', cat: 'oyoq' },
]
