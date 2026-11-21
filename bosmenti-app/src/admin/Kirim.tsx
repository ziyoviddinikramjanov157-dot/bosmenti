import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { adminApi, loadCatalog, send, type Catalog, type Found, type Label } from './api'
import { PickDialog, type Picked } from './Pick'
import { beep, labelsHtml, printHtml, useScanner } from './pos'

interface Line { variantId: number; productId: string; name: string; color: string; size: string; qty: number }
interface Move { id: number; qty: number; reason: string; note: string; createdAt: string; name: string; color: string; size: string }

const time = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function Kirim() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; code?: string } | null>(null)
  const [picking, setPicking] = useState<{ code?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Move[] | null>(null)

  const loadHistory = useCallback(() => {
    adminApi<{ moves: Move[] }>('/api/admin/stock/moves?reason=intake').then(r => setHistory(r.moves), () => setHistory([]))
  }, [])

  useEffect(() => {
    loadCatalog().then(setCatalog, (e: Error) => setMsg({ text: e.message, bad: true }))
    loadHistory()
  }, [loadHistory])

  const add = (f: Found, qty = 1) => {
    setLines(ls => {
      const i = ls.findIndex(l => l.variantId === f.variant.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l))
      return [{ variantId: f.variant.id, productId: f.product.id, name: f.product.name, color: f.variant.color, size: f.variant.size, qty }, ...ls]
    })
    setMsg({ text: `+${qty}: ${f.product.name} · ${f.variant.color}, ${f.variant.size}` })
    beep(true)
  }

  const scan = async (code: string) => {
    try {
      add(await adminApi<Found>(`/api/admin/lookup?code=${encodeURIComponent(code)}`))
    } catch (e) {
      beep(false)
      const err = e as ApiError
      if (err.status === 404) {
        setMsg({ text: `Yangi kod: ${code}. Uni qaysi kiyim ekanini tanlang.`, bad: true, code })
        setPicking({ code })
      } else setMsg({ text: err.message, bad: true })
    }
  }
  useScanner(scan, !picking && !busy)

  const pick = async (p: Picked, code?: string) => {
    if (code) await send('POST', '/api/admin/barcodes', { code, ...p })
    add(await send<Found>('POST', '/api/admin/variants', p))
    setPicking(null)
  }

  const setQty = (i: number, v: string) => {
    const qty = Math.max(0, Math.min(10_000, Math.round(Number(v) || 0)))
    setLines(ls => ls.map((l, j) => (j === i ? { ...l, qty } : l)))
  }

  const count = lines.reduce((s, l) => s + l.qty, 0)

  const save = async () => {
    const ok = lines.filter(l => l.qty > 0)
    if (!ok.length) return setMsg({ text: 'Kirim bo‘sh: tovarni skanerlang', bad: true })
    setBusy(true)
    try {
      await send('POST', '/api/admin/intake', { lines: ok.map(l => ({ variantId: l.variantId, qty: l.qty })), note })
      setMsg({ text: `Omborga ${count} ta tovar qo‘shildi` })
      setLines([])
      setNote('')
      loadHistory()
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  const printLabels = async () => {
    const items = lines.filter(l => l.qty > 0).map(l => ({ productId: l.productId, color: l.color, size: l.size, copies: l.qty }))
    if (!items.length || !catalog) return
    try {
      const r = await send<{ labels: Label[] }>('POST', '/api/admin/labels', { items })
      printHtml(labelsHtml(r.labels), catalog.shop.receiptWidth)
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    }
  }

  return (
    <section>
      <div className="a-head">
        <h1>Kirim <small>yangi kelgan tovar</small></h1>
        <button className="a-btn" onClick={() => setPicking({})} disabled={!catalog}>Kodsiz tovar qo‘shish</button>
      </div>
      <p className="a-muted">Tovarni skanerlang: har skanerlash soniga bitta qo‘shadi. Sonini qo‘lda ham o‘zgartirish mumkin. Kod tanilmasa, uni bir marta kiyimga bog‘laysiz.</p>
      {msg && <div className={'k-msg' + (msg.bad ? ' bad' : '')} role="status"><span>{msg.text}</span></div>}

      {lines.length > 0 && (
        <div className="a-card k-intake">
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Kiyim</th><th>Rang · o‘lcham</th><th className="r">Soni</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.variantId}>
                    <td><b>{l.name}</b></td>
                    <td>{l.color} · {l.size}</td>
                    <td className="r"><input className="k-num" type="number" min={0} value={l.qty} onChange={e => setQty(i, e.target.value)} aria-label={`${l.name} soni`} /></td>
                    <td className="r"><button className="a-link" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Olib tashlash</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="a-form">Izoh <small>(yetkazib beruvchi, hujjat raqami)</small>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Masalan: Ali aka, 12-faktura" />
          </label>
          <div className="a-actions">
            <button className="a-btn primary" onClick={save} disabled={busy}>{busy ? 'Saqlanmoqda…' : `Kirimni saqlash · ${count} ta`}</button>
            <button className="a-btn" onClick={printLabels}>Shularga yorliq chiqarish</button>
          </div>
        </div>
      )}

      <h2 className="a-sub">Oxirgi kirimlar</h2>
      {!history ? <p className="a-muted">Yuklanmoqda…</p> : history.length === 0 ? <p className="a-muted">Hali kirim yo‘q.</p> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Vaqt</th><th>Kiyim</th><th>Rang · o‘lcham</th><th className="r">Soni</th><th>Izoh</th></tr></thead>
            <tbody>
              {history.map(m => (
                <tr key={m.id}>
                  <td className="nw">{time(m.createdAt)}</td>
                  <td>{m.name}</td>
                  <td>{m.color} · {m.size}</td>
                  <td className="r"><b>+{m.qty}</b></td>
                  <td>{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking && catalog && (
        <PickDialog
          catalog={catalog}
          title={picking.code ? 'Yangi kodni kiyimga bog‘lash' : 'Kodsiz tovar qo‘shish'}
          hint={picking.code ? `Kod ${picking.code} keyingi safar kassada va kirimda shu kiyim sifatida taniladi.` : 'Keyin “Shularga yorliq chiqarish” bilan unga shtrix-kod chop etasiz.'}
          submitLabel={picking.code ? 'Bog‘lash va qo‘shish' : 'Kirimga qo‘shish'}
          onPick={p => pick(p, picking.code)}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  )
}
