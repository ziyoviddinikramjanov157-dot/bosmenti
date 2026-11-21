import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Catalog } from './api'

export interface Picked { productId: string; color: string; size: string }

/**
 * Choosing a product, colour and size by hand: for items without a code, or to tie an unknown code to an item.
 * Shown as a side panel; Escape or a click outside closes it.
 */
export function PickDialog({ catalog, title, hint, initialQuery = '', submitLabel, onPick, onClose }: {
  catalog: Catalog
  title: string
  hint?: string
  initialQuery?: string
  submitLabel: string
  onPick: (p: Picked) => Promise<void>
  onClose: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  const [productId, setProductId] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    return catalog.products.filter(p => !t || p.name.toLowerCase().includes(t)).slice(0, 40)
  }, [catalog, q])
  const product = catalog.products.find(p => p.id === productId)
  const sizes = product ? catalog.sizes[product.sz] ?? [] : []

  const choose = (id: string) => {
    const p = catalog.products.find(x => x.id === id)
    setProductId(id)
    setColor(p?.colors.length === 1 ? p.colors[0].n : '')
    setSize('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!productId || !color || !size) return setError('Kiyim, rang va o‘lchamni tanlang')
    setBusy(true)
    setError('')
    try {
      await onPick({ productId, color, size })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="a-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="a-panel a-form" role="dialog" aria-modal="true" aria-labelledby="pick-title" onSubmit={submit}>
        <div className="a-panel-head">
          <h2 id="pick-title">{title}</h2>
          <button type="button" className="a-x" onClick={onClose} aria-label="Yopish">×</button>
        </div>
        {hint && <p className="a-muted">{hint}</p>}
        <label>Kiyim nomi<input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Masalan, jinsi" /></label>
        <div className="a-picklist" role="listbox" aria-label="Kiyimlar">
          {matches.map(p => (
            <button type="button" role="option" aria-selected={p.id === productId} key={p.id} className={p.id === productId ? 'on' : ''} onClick={() => choose(p.id)}>
              {p.name}
            </button>
          ))}
          {!matches.length && <p className="a-muted">Topilmadi. Yangi kiyimni “Mahsulotlar” bo‘limida qo‘shing.</p>}
        </div>
        {product && (
          <>
            <fieldset>
              <legend>Rang</legend>
              <div className="a-chips">
                {product.colors.map(c => (
                  <button type="button" key={c.n} className={color === c.n ? 'on' : ''} onClick={() => setColor(c.n)}>
                    <i style={{ background: c.c }} />{c.n}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>O‘lcham</legend>
              <div className="a-chips">
                {sizes.map(s => <button type="button" key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s}</button>)}
              </div>
            </fieldset>
          </>
        )}
        {error && <p className="a-err" role="alert">{error}</p>}
        <div className="a-actions">
          <button className="a-btn primary" disabled={busy || !productId || !color || !size}>{submitLabel}</button>
          <button type="button" className="a-btn" onClick={onClose}>Bekor qilish</button>
        </div>
      </form>
    </div>
  )
}
