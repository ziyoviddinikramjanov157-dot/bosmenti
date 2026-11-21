import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ApiError } from '../lib/api'
import { fmt, fmtPh } from '../lib/util'
import { adminApi, loadCatalog, send, type AdminOrder, type Catalog, type Found } from './api'
import { PickDialog, type Picked } from './Pick'
import { asset, beep, printHtml, receiptHtml, useScanner } from './pos'

interface Line {
  variantId: number; name: string; color: string; size: string; price: number; basePrice: number
  image: string | null; qty: number; stock: number
}

const digits9 = (v: string) => {
  let d = v.replace(/\D/g, '')
  if (d.startsWith('998') && d.length > 9) d = d.slice(3)
  return d.slice(0, 9)
}
const amount = (v: string) => Math.max(0, Math.round(Number(v.replace(/\s/g, '')) || 0))
const readPref = () => { try { return localStorage.getItem('bos-autoprint') === '1' } catch { return false } }

export function Kassa() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [cash, setCash] = useState('')
  const [card, setCard] = useState('')
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [due, setDue] = useState('')
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; code?: string } | null>(null)
  const [picking, setPicking] = useState<{ code?: string; q?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ order: AdminOrder; change: number } | null>(null)
  const [autoPrint, setAutoPrint] = useState(readPref)

  useEffect(() => {
    loadCatalog().then(setCatalog, (e: Error) => setMsg({ text: e.message, bad: true }))
  }, [])

  const add = (f: Found) => {
    setDone(null)
    setLines(ls => {
      const i = ls.findIndex(l => l.variantId === f.variant.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, {
        variantId: f.variant.id, name: f.product.name, color: f.variant.color, size: f.variant.size,
        price: f.product.price, basePrice: f.product.basePrice, image: f.product.image, qty: 1, stock: f.variant.stock,
      }]
    })
    setMsg({ text: `Qo‘shildi: ${f.product.name} · ${f.variant.color}, ${f.variant.size}` })
    beep(true)
  }

  const scan = async (code: string) => {
    try {
      add(await adminApi<Found>(`/api/admin/lookup?code=${encodeURIComponent(code)}`))
    } catch (e) {
      beep(false)
      const err = e as ApiError
      setMsg(err.status === 404 ? { text: `Bu kod tanilmadi: ${code}`, bad: true, code } : { text: err.message, bad: true })
    }
  }
  useScanner(scan, !picking && !busy)

  const onQuery = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const v = query.trim()
    setQuery('')
    if (/^\d{6,}$/.test(v)) scan(v)
    else setPicking({ q: v })
  }

  const pick = async (p: Picked, code?: string) => {
    if (code) await send('POST', '/api/admin/barcodes', { code, ...p })
    add(await send<Found>('POST', '/api/admin/variants', p))
    setPicking(null)
  }

  const setQty = (i: number, qty: number) =>
    setLines(ls => (qty < 1 ? ls.filter((_, j) => j !== i) : ls.map((l, j) => (j === i ? { ...l, qty: Math.min(100, qty) } : l))))

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)
  const discount = lines.reduce((s, l) => s + (l.basePrice - l.price) * l.qty, 0)
  const cardPart = Math.min(amount(card), total)
  const cashDue = total - cardPart
  const cashGiven = amount(cash)
  const cashPart = Math.min(cashGiven, cashDue)
  const change = Math.max(0, cashGiven - cashDue)
  const debt = total - cardPart - cashPart

  const reset = () => {
    setLines([]); setCash(''); setCard(''); setCustomer({ name: '', phone: '' }); setDue('')
  }

  const print = (o: AdminOrder, ch: number) => catalog && printHtml(receiptHtml(o, catalog.shop, ch), catalog.shop.receiptWidth)

  const sell = async () => {
    if (!lines.length) return setMsg({ text: 'Avval kiyimni skanerlang', bad: true })
    if (amount(card) > total) return setMsg({ text: 'Karta summasi jamidan ko‘p', bad: true })
    if (debt > 0 && (customer.name.trim().length < 2 || customer.phone.length !== 9))
      return setMsg({ text: 'Nasiya yoki qisman to‘lovda mijozning ismi va telefonini kiriting', bad: true })
    setBusy(true)
    try {
      const order = await send<AdminOrder>('POST', '/api/admin/sales', {
        items: lines.map(l => ({ variantId: l.variantId, qty: l.qty })),
        customer: { name: customer.name.trim(), phone: customer.phone },
        payments: [
          ...(cashPart ? [{ method: 'cash', amount: cashPart }] : []),
          ...(cardPart ? [{ method: 'card', amount: cardPart }] : []),
        ],
        dueDate: debt > 0 && due ? due : null,
      })
      setDone({ order, change })
      setMsg(null)
      reset()
      if (autoPrint) print(order, change)
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  const toggleAuto = (on: boolean) => {
    setAutoPrint(on)
    try { localStorage.setItem('bos-autoprint', on ? '1' : '0') } catch { /* ignore */ }
  }

  return (
    <section className="k-wrap">
      <div className="k-main">
        <div className="k-scan">
          <span className="k-dot" aria-hidden="true" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onQuery}
            placeholder="Skanerlang yoki kiyim nomini yozib Enter bosing"
            aria-label="Kiyim qidirish"
          />
          <button className="a-btn" onClick={() => setPicking({})} disabled={!catalog}>Qo‘lda tanlash</button>
        </div>
        {msg && (
          <div className={'k-msg' + (msg.bad ? ' bad' : '')} role="status">
            <span>{msg.text}</span>
            {msg.code && catalog && <button className="a-btn" onClick={() => setPicking({ code: msg.code })}>Kiyimga bog‘lash</button>}
          </div>
        )}

        {lines.length ? (
          <ul className="k-lines">
            {lines.map((l, i) => (
              <li key={l.variantId}>
                {l.image ? <img src={asset(l.image)} alt="" /> : <span className="a-noimg" />}
                <div className="k-li">
                  <b>{l.name}</b>
                  <small>{l.color} · {l.size}{l.stock - l.qty < 0 ? ' · omborda yo‘q' : ''}</small>
                  <small>{l.basePrice > l.price && <s>{fmt(l.basePrice)}</s>} {fmt(l.price)}</small>
                </div>
                <div className="k-qty">
                  <button onClick={() => setQty(i, l.qty - 1)} aria-label="Kamaytirish">−</button>
                  <b>{l.qty}</b>
                  <button onClick={() => setQty(i, l.qty + 1)} aria-label="Ko‘paytirish">+</button>
                </div>
                <b className="k-sum">{fmt(l.price * l.qty)}</b>
              </li>
            ))}
          </ul>
        ) : done ? (
          <div className="k-done">
            <h2>Savdo № {done.order.no} saqlandi</h2>
            <p>Jami {fmt(done.order.total)}{done.change > 0 && <> · Qaytim <b>{fmt(done.change)}</b></>}{done.order.debt > 0 && <> · Qarz <b>{fmt(done.order.debt)}</b></>}</p>
            <div className="a-actions">
              <button className="a-btn primary" onClick={() => print(done.order, done.change)}>Chek chiqarish</button>
              <button className="a-btn" onClick={() => setDone(null)}>Yangi savdo</button>
            </div>
          </div>
        ) : (
          <div className="k-empty">
            <b>Kiyimni skanerlang</b>
            <p>Skaner kodni o‘qishi bilan kiyim shu ro‘yxatga tushadi. Kodi bo‘lmagan kiyimni “Qo‘lda tanlash” orqali qo‘shing.</p>
          </div>
        )}
      </div>

      <aside className="k-side">
        <div className="k-total">
          <span>Jami</span>
          <b>{fmt(total)}</b>
          {discount > 0 && <small>Chegirma: {fmt(discount)}</small>}
        </div>

        <div className="k-quick">
          <button className="a-btn" disabled={!total} onClick={() => { setCash(String(total)); setCard('') }}>Hammasi naqd</button>
          <button className="a-btn" disabled={!total} onClick={() => { setCard(String(total)); setCash('') }}>Hammasi karta</button>
          <button className="a-btn" disabled={!total} onClick={() => { setCash(''); setCard('') }}>Nasiya</button>
        </div>
        <div className="a-row k-pay">
          <label>Naqd berdi<input inputMode="numeric" value={cash} onChange={e => setCash(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" /></label>
          <label>Karta<input inputMode="numeric" value={card} onChange={e => setCard(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" /></label>
        </div>
        <dl className="a-dl k-calc">
          {change > 0 && <><dt>Qaytim</dt><dd><b>{fmt(change)}</b></dd></>}
          <dt>Qarz qoladi</dt><dd className={debt > 0 ? 'k-debt' : ''}>{fmt(debt)}</dd>
        </dl>

        <fieldset className="k-cust">
          <legend>Mijoz {debt > 0 ? '(nasiya uchun shart)' : '(ixtiyoriy)'}</legend>
          <input placeholder="Ismi" value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} maxLength={60} aria-label="Mijoz ismi" />
          <div className="k-phone"><span>+998</span><input inputMode="numeric" placeholder="90 123 45 67" aria-label="Mijoz telefoni" value={fmtPh(customer.phone)} onChange={e => setCustomer({ ...customer, phone: digits9(e.target.value) })} /></div>
          {debt > 0 && <label>Qarzni qaytarish sanasi<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>}
        </fieldset>

        <button className="a-btn primary k-sell" onClick={sell} disabled={busy || !lines.length}>
          {busy ? 'Saqlanmoqda…' : debt > 0 ? `Sotish (qarz ${fmt(debt)})` : 'Sotish'}
        </button>
        <label className="k-auto"><input type="checkbox" checked={autoPrint} onChange={e => toggleAuto(e.target.checked)} /> Sotilgach chekni avtomatik chiqarish</label>
        {lines.length > 0 && <button className="a-link k-clear" onClick={reset}>Savdoni tozalash</button>}
      </aside>

      {picking && catalog && (
        <PickDialog
          catalog={catalog}
          title={picking.code ? 'Kodni kiyimga bog‘lash' : 'Kiyimni tanlash'}
          hint={picking.code ? `Kod ${picking.code} keyingi safar shu kiyim sifatida taniladi.` : undefined}
          initialQuery={picking.q}
          submitLabel={picking.code ? 'Bog‘lash va qo‘shish' : 'Savdoga qo‘shish'}
          onPick={p => pick(p, picking.code)}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  )
}
