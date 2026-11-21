import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fmt } from '../lib/util'
import { adminApi, loadCatalog, PAY_STATE, send, STATUS, type AdminOrder, type Settings, type Status } from './api'
import { isoDay, periodRange, showDate, showTime, type PeriodKey } from './period'
import { asset, printHtml, receiptHtml } from './pos'

type Channel = '' | 'store' | 'online'
type PayFilter = '' | 'debt' | 'partial' | 'unpaid' | 'paid'

const CHANNELS: [Channel, string][] = [['', 'Hammasi'], ['store', 'Do‘kon'], ['online', 'Sayt']]
const PAYS: [PayFilter, string][] = [['', 'Har qanday to‘lov'], ['debt', 'Qarzdorlar'], ['partial', 'Qisman'], ['unpaid', 'To‘lanmagan'], ['paid', 'To‘langan']]
const RANGES: [PeriodKey, string][] = [['all', 'Hamma vaqt'], ['today', 'Bugun'], ['week', '7 kun'], ['month', 'Shu oy']]
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`
const methodName = (m: 'cash' | 'card') => (m === 'cash' ? 'Naqd' : 'Karta')
const overdue = (o: AdminOrder) => o.debt > 0 && !!o.dueDate && o.dueDate < isoDay()

export function Sales() {
  const [channel, setChannel] = useState<Channel>('')
  const [pay, setPay] = useState<PayFilter>('')
  const [range, setRange] = useState<PeriodKey>('all')
  const [status, setStatus] = useState<Status | ''>('')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<{ orders: AdminOrder[]; counts: Partial<Record<Status, number>> } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<AdminOrder | null>(null)
  const [shop, setShop] = useState<Settings | null>(null)

  useEffect(() => {
    loadCatalog().then(c => setShop(c.shop), () => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (channel) p.set('channel', channel)
    if (pay) p.set('pay', pay)
    if (channel === 'online' && status) p.set('status', status)
    const r = periodRange(range)
    if (r) { p.set('from', r.from); p.set('to', r.to) }
    if (q) p.set('q', q)
    adminApi<{ orders: AdminOrder[]; counts: Partial<Record<Status, number>> }>(`/api/admin/orders?${p}`).then(
      d => { setData(d); setError('') },
      (e: Error) => setError(e.message),
    )
  }, [channel, pay, range, status, q])

  // new website orders show up without reloading the page
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const newOnline = data?.counts.new ?? 0

  return (
    <section>
      <div className="a-head">
        <h1>Savdolar</h1>
        <input className="a-search" type="search" placeholder="№, telefon yoki ism" aria-label="Savdo qidirish" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="a-filter">
        {CHANNELS.map(([c, label]) => (
          <button key={c} className={channel === c ? 'on' : ''} onClick={() => { setChannel(c); setStatus('') }}>
            {label}{c === 'online' && newOnline > 0 && <b className="hot">{newOnline} yangi</b>}
          </button>
        ))}
        <select value={pay} onChange={e => setPay(e.target.value as PayFilter)} aria-label="To‘lov holati">
          {PAYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={range} onChange={e => setRange(e.target.value as PeriodKey)} aria-label="Davr">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {channel === 'online' && (
        <div className="a-filter">
          <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>Barcha holatlar</button>
          {(Object.keys(STATUS) as Status[]).map(s => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {STATUS[s]} <b className={s === 'new' && data?.counts.new ? 'hot' : ''}>{data?.counts[s] ?? 0}</b>
            </button>
          ))}
        </div>
      )}

      {error && <p className="a-err">{error}</p>}
      {!data ? <p className="a-muted">Yuklanmoqda…</p> : data.orders.length === 0 ? (
        <p className="a-muted">Bunday savdo topilmadi.</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>№</th><th>Vaqt</th><th>Qayerdan</th><th>Mijoz</th><th className="r">Summa</th><th>To‘lov</th><th>Holat</th></tr></thead>
            <tbody>
              {data.orders.map(o => (
                <tr key={o.no} onClick={() => setOpen(o)} className={o.channel === 'online' && o.status === 'new' ? 'is-new' : ''}>
                  <td><button className="a-link" onClick={() => setOpen(o)}>{o.no}</button></td>
                  <td className="nw">{showTime(o.createdAt)}</td>
                  <td><span className={'a-tag ' + o.channel}>{o.channel === 'store' ? 'Do‘kon' : 'Sayt'}</span></td>
                  <td>{o.name ? <><b>{o.name}</b><br /><small>{o.phone}</small></> : <small>—</small>}</td>
                  <td className="r nw">{fmt(o.total)}</td>
                  <td className="nw">
                    <span className={`a-pay ${o.payState}`}>{PAY_STATE[o.payState]}</span>
                    {o.debt > 0 && o.status !== 'cancelled' && <small className={overdue(o) ? 'a-late' : ''}><br />qarz {fmt(o.debt)}</small>}
                  </td>
                  <td>{o.channel === 'online' ? <span className={`a-st st-${o.status}`}>{STATUS[o.status]}</span> : o.status === 'cancelled' ? <span className="a-st st-cancelled">Bekor qilingan</span> : <small>Sotildi</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <SaleDetail order={open} shop={shop} onClose={() => setOpen(null)} onSaved={o => { setOpen(o); load() }} />}
    </section>
  )
}

function SaleDetail({ order: o, shop, onClose, onSaved }: { order: AdminOrder; shop: Settings | null; onClose: () => void; onSaved: (o: AdminOrder) => void }) {
  const [note, setNote] = useState(o.adminNote)
  const [amount, setAmount] = useState(String(o.debt))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [payNote, setPayNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAmount(String(o.debt))
  }, [o.debt])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])

  const run = async (fn: () => Promise<AdminOrder>) => {
    setBusy(true)
    setError('')
    try {
      onSaved(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addPayment = (e: FormEvent) => {
    e.preventDefault()
    run(() => send<AdminOrder>('POST', `/api/admin/orders/${o.no}/payments`, { amount: Math.round(Number(amount) || 0), method, note: payNote })).then(() => setPayNote(''))
  }

  return (
    <div className="a-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="a-panel" role="dialog" aria-modal="true" aria-labelledby="sale-title">
        <div className="a-panel-head">
          <h2 id="sale-title">{o.channel === 'store' ? 'Savdo' : 'Buyurtma'} № {o.no}</h2>
          <button className="a-x" onClick={onClose} aria-label="Yopish">×</button>
        </div>
        <p className="a-muted">{showTime(o.createdAt)} · {o.channel === 'store' ? 'Do‘konda sotilgan' : 'Saytdan buyurtma'}</p>

        <dl className="a-dl">
          <dt>Mijoz</dt><dd>{o.name || '—'}</dd>
          {o.phone && <><dt>Telefon</dt><dd><a href={telHref(o.phone)}>{o.phone}</a></dd></>}
          {o.channel === 'online' && <><dt>Qabul qilish</dt><dd>{o.ship === 'pickup' ? 'Do‘kondan olib ketadi' : o.address}</dd></>}
          {o.channel === 'online' && <><dt>To‘lov usuli</dt><dd>{o.pay === 'card' ? 'Do‘kon kartasiga o‘tkazma' : 'Naqd, qabul qilganda'}</dd></>}
          {o.note && <><dt>Izoh</dt><dd>{o.note}</dd></>}
        </dl>

        <ul className="a-items">
          {o.items.map((i, k) => (
            <li key={k}>
              {i.image ? <img src={asset(i.image)} alt="" /> : <span className="a-noimg" />}
              <div><b>{i.name}</b><small>{i.color} · {i.size} · {i.qty} dona{i.basePrice > i.price ? ` · chegirma ${fmt((i.basePrice - i.price) * i.qty)}` : ''}</small></div>
              <span className="nw">{fmt(i.price * i.qty)}</span>
            </li>
          ))}
        </ul>
        <dl className="a-dl a-sum">
          {o.discountTotal > 0 && <><dt>Chegirma</dt><dd>−{fmt(o.discountTotal)}</dd></>}
          {o.channel === 'online' && <><dt>Yetkazib berish</dt><dd>{o.shipFee ? fmt(o.shipFee) : 'Bepul'}</dd></>}
          <dt><b>Jami</b></dt><dd><b>{fmt(o.total)}</b></dd>
          <dt>To‘langan</dt><dd>{fmt(o.paid)}</dd>
          {o.debt > 0 && <><dt><b>Qarz</b></dt><dd className={overdue(o) ? 'a-late' : ''}><b>{fmt(o.debt)}</b>{o.dueDate && <><br /><small>muddat {showDate(o.dueDate)}</small></>}</dd></>}
        </dl>

        <h3>To‘lovlar</h3>
        {o.payments.length ? (
          <ul className="a-pays">
            {o.payments.map(p => <li key={p.id}><span className="nw">{showTime(p.createdAt)}</span><span>{methodName(p.method)}{p.note && ` · ${p.note}`}</span><b className="nw">{fmt(p.amount)}</b></li>)}
          </ul>
        ) : <p className="a-muted">Hali to‘lov yo‘q.</p>}

        {o.debt > 0 && o.status !== 'cancelled' && (
          <form className="a-addpay" onSubmit={addPayment}>
            <div className="a-row">
              <label>Summa<input type="number" min={1} max={o.debt} value={amount} onChange={e => setAmount(e.target.value)} /></label>
              <label>Turi
                <select value={method} onChange={e => setMethod(e.target.value as 'cash' | 'card')}><option value="cash">Naqd</option><option value="card">Karta</option></select>
              </label>
            </div>
            <label>Izoh<input value={payNote} onChange={e => setPayNote(e.target.value)} maxLength={200} placeholder="Ixtiyoriy" /></label>
            <button className="a-btn primary" disabled={busy}>To‘lovni qo‘shish</button>
          </form>
        )}

        {o.channel === 'online' && (
          <>
            <h3>Holat</h3>
            <div className="a-status">
              {(Object.keys(STATUS) as Status[]).map(s => (
                <button key={s} className={`a-st st-${s}` + (o.status === s ? ' on' : '')} disabled={busy || o.status === s}
                  onClick={() => run(() => send<AdminOrder>('PATCH', `/api/admin/orders/${o.no}`, { status: s }))}>
                  {STATUS[s]}
                </button>
              ))}
            </div>
          </>
        )}

        <h3><label htmlFor="anote">Ichki izoh</label></h3>
        <textarea id="anote" rows={2} placeholder="Faqat admin ko‘radi" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
        {error && <p className="a-err" role="alert">{error}</p>}
        <div className="a-actions">
          <button className="a-btn" disabled={busy || note === o.adminNote} onClick={() => run(() => send<AdminOrder>('PATCH', `/api/admin/orders/${o.no}`, { adminNote: note }))}>Izohni saqlash</button>
          {shop && <button className="a-btn" onClick={() => printHtml(receiptHtml(o, shop), shop.receiptWidth)}>Chek chiqarish</button>}
          {o.channel === 'store' && o.status !== 'cancelled' && (
            <button className="a-btn danger" disabled={busy}
              onClick={() => confirm('Savdo bekor qilinsinmi? Kiyimlar omborga qaytadi.') && run(() => send<AdminOrder>('PATCH', `/api/admin/orders/${o.no}`, { status: 'cancelled' }))}>
              Savdoni bekor qilish
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
