import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmt } from '../lib/util'
import { adminApi, loadCatalog, send, type Catalog, type Label, type StockProduct } from './api'
import { asset, labelsHtml, printHtml } from './pos'

interface Cell { product: StockProduct; color: string; size: string; stock: number; variantId?: number; codes: string[] }

const LOW = 2

export function Ombor() {
  const [list, setList] = useState<StockProduct[] | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [error, setError] = useState('')
  const [cell, setCell] = useState<Cell | null>(null)

  const load = useCallback(() => {
    adminApi<{ products: StockProduct[] }>('/api/admin/stock').then(r => setList(r.products), (e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    load()
    loadCatalog().then(setCatalog, () => {})
  }, [load])

  const stockOf = (p: StockProduct, color: string, size: string) => p.variants.find(v => v.color === color && v.size === size)
  const total = (p: StockProduct) => p.variants.reduce((s, v) => s + v.stock, 0)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (list ?? []).filter(p =>
      (!t || p.name.toLowerCase().includes(t)) &&
      (!onlyLow || (p.track && p.colors.some(c => p.sizes.some(s => (stockOf(p, c.n, s)?.stock ?? 0) <= LOW)))))
  }, [list, q, onlyLow])

  const toggle = async (p: StockProduct) => {
    try {
      await send('POST', '/api/admin/stock/tracking', { productId: p.id, on: !p.track })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!list) return <p className={error ? 'a-err' : 'a-muted'}>{error || 'Yuklanmoqda…'}</p>

  return (
    <section>
      <div className="a-head">
        <h1>Ombor <small>qoldiqlar</small></h1>
      </div>
      <div className="a-tools">
        <input className="a-search" type="search" placeholder="Kiyim nomi" aria-label="Kiyim qidirish" value={q} onChange={e => setQ(e.target.value)} />
        <label className="a-check"><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Faqat {LOW} tadan kam qolganlar</label>
      </div>
      <p className="a-muted">Raqamni bosib aniq sonini kiriting yoki yorliq chiqaring. “Nazorat” yoqilgan kiyimning tugagan o‘lchamini saytda tanlab bo‘lmaydi; kirim qilinganda u o‘zi yoqiladi.</p>
      {error && <p className="a-err">{error}</p>}

      <div className="o-list">
        {shown.map(p => (
          <article key={p.id} className={'a-card o-item' + (p.active ? '' : ' is-off')}>
            <header>
              {p.image ? <img src={asset(p.image)} alt="" /> : <span className="a-noimg" />}
              <div><b>{p.name}</b><small>{fmt(p.price)} · jami {total(p)} ta{p.active ? '' : ' · saytda yashirilgan'}</small></div>
              <button className={'a-toggle' + (p.track ? ' on' : '')} onClick={() => toggle(p)} aria-pressed={p.track}>
                {p.track ? 'Nazorat yoqilgan' : 'Nazorat o‘chiq'}
              </button>
            </header>
            <div className="a-table-wrap">
              <table className="o-grid">
                <thead><tr><th />{p.sizes.map(s => <th key={s}>{s}</th>)}</tr></thead>
                <tbody>
                  {p.colors.map(c => (
                    <tr key={c.n}>
                      <th><i style={{ background: c.c }} />{c.n}</th>
                      {p.sizes.map(s => {
                        const v = stockOf(p, c.n, s)
                        const n = v?.stock ?? 0
                        return (
                          <td key={s}>
                            <button
                              className={n < 0 ? 'neg' : n === 0 ? 'zero' : n <= LOW ? 'low' : ''}
                              onClick={() => setCell({ product: p, color: c.n, size: s, stock: n, variantId: v?.id, codes: v?.codes ?? [] })}
                              aria-label={`${c.n}, ${s}: ${n} ta`}
                            >{n}</button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
        {!shown.length && <p className="a-muted">Hech narsa topilmadi.</p>}
      </div>

      {cell && <CellPanel cell={cell} width={catalog?.shop.receiptWidth ?? 80} onClose={() => setCell(null)} onSaved={() => { setCell(null); load() }} />}
    </section>
  )
}

function CellPanel({ cell, width, onClose, onSaved }: { cell: Cell; width: number; onClose: () => void; onSaved: () => void }) {
  const [stock, setStock] = useState(String(cell.stock))
  const [note, setNote] = useState('')
  const [copies, setCopies] = useState(String(Math.max(1, cell.stock)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])

  const ensureId = async () =>
    cell.variantId ?? (await send<{ variant: { id: number } }>('POST', '/api/admin/variants', { productId: cell.product.id, color: cell.color, size: cell.size })).variant.id

  const saveStock = async () => {
    setBusy(true)
    setError('')
    try {
      await send('POST', '/api/admin/stock/adjust', { variantId: await ensureId(), stock: Math.round(Number(stock) || 0), note })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const printLabels = async () => {
    try {
      const r = await send<{ labels: Label[] }>('POST', '/api/admin/labels', {
        items: [{ productId: cell.product.id, color: cell.color, size: cell.size, copies: Math.max(1, Math.min(500, Math.round(Number(copies) || 1))) }],
      })
      printHtml(labelsHtml(r.labels), width)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="a-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="a-panel a-form" role="dialog" aria-modal="true" aria-labelledby="cell-title">
        <div className="a-panel-head">
          <h2 id="cell-title">{cell.product.name}</h2>
          <button className="a-x" onClick={onClose} aria-label="Yopish">×</button>
        </div>
        <p className="a-muted">{cell.color} · {cell.size} · hozir {cell.stock} ta</p>
        <p className="a-muted">Shtrix-kodlar: {cell.codes.length ? cell.codes.join(', ') : 'hali yo‘q (yorliq chiqarilganda paydo bo‘ladi)'}</p>
        <h3>Sanoqdan keyin aniq soni</h3>
        <div className="a-row">
          <label>Soni<input type="number" value={stock} onChange={e => setStock(e.target.value)} /></label>
          <label>Izoh<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Masalan, oylik sanoq" /></label>
        </div>
        <div className="a-actions"><button className="a-btn primary" onClick={saveStock} disabled={busy}>Sonini saqlash</button></div>
        <h3>Shtrix-kodli yorliq</h3>
        <div className="a-row">
          <label>Nechta<input type="number" min={1} max={500} value={copies} onChange={e => setCopies(e.target.value)} /></label>
        </div>
        <div className="a-actions"><button className="a-btn" onClick={printLabels}>Yorliq chiqarish</button></div>
        {error && <p className="a-err" role="alert">{error}</p>}
      </div>
    </div>
  )
}
