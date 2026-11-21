import { useEffect, useState } from 'react'
import { fmt } from '../lib/util'
import { adminApi } from './api'
import { isoDay, PERIODS, periodRange, showDate, showTime, type PeriodKey } from './period'

interface ReportData {
  sales: Record<'store' | 'online', { count: number; total: number; discount: number }>
  money: Record<'cash' | 'card', { count: number; amount: number }>
  debts: { total: number; list: { no: number; channel: string; name: string; phone: string; total: number; paid: number; debt: number; createdAt: string; dueDate: string | null }[] }
  pendingOnline: { count: number; amount: number }
  top: { productId: string; name: string; qty: number; amount: number }[]
}

export function Report() {
  const [key, setKey] = useState<PeriodKey>('today')
  const [custom, setCustom] = useState({ from: isoDay(), to: isoDay() })
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const r = periodRange(key, custom)
    if (!r) return
    setData(null)
    adminApi<ReportData>(`/api/admin/report?${new URLSearchParams(r)}`).then(
      d => { setData(d); setError('') },
      (e: Error) => setError(e.message),
    )
  }, [key, custom])

  const sold = data ? data.sales.store.total + data.sales.online.total : 0
  const cameIn = data ? data.money.cash.amount + data.money.card.amount : 0
  const today = isoDay()

  return (
    <section>
      <div className="a-head"><h1>Hisobot</h1></div>
      <div className="a-filter">
        {PERIODS.map(([k, l]) => <button key={k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{l}</button>)}
        <button className={key === 'custom' ? 'on' : ''} onClick={() => setKey('custom')}>Boshqa davr</button>
        {key === 'custom' && (
          <span className="r-dates">
            <input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({ ...custom, from: e.target.value })} aria-label="Boshlanish sanasi" />
            —
            <input type="date" value={custom.to} min={custom.from} onChange={e => setCustom({ ...custom, to: e.target.value })} aria-label="Tugash sanasi" />
          </span>
        )}
      </div>
      {error && <p className="a-err">{error}</p>}
      {!data ? <p className="a-muted">{error ? '' : 'Yuklanmoqda…'}</p> : (
        <>
          <div className="r-cards">
            <div className="r-card big"><span>Jami savdo</span><b>{fmt(sold)}</b><small>{data.sales.store.count + data.sales.online.count} ta savdo</small></div>
            <div className="r-card"><span>Do‘kondan</span><b>{fmt(data.sales.store.total)}</b><small>{data.sales.store.count} ta savdo</small></div>
            <div className="r-card"><span>Saytdan</span><b>{fmt(data.sales.online.total)}</b><small>{data.sales.online.count} ta buyurtma</small></div>
            <div className="r-card"><span>Berilgan chegirma</span><b>{fmt(data.sales.store.discount + data.sales.online.discount)}</b></div>
          </div>
          <div className="r-cards">
            <div className="r-card big"><span>Kassaga tushgan pul</span><b>{fmt(cameIn)}</b><small>qarz to‘lovlari ham shu yerda</small></div>
            <div className="r-card"><span>Naqd</span><b>{fmt(data.money.cash.amount)}</b><small>{data.money.cash.count} ta to‘lov</small></div>
            <div className="r-card"><span>Karta</span><b>{fmt(data.money.card.amount)}</b><small>{data.money.card.count} ta to‘lov</small></div>
            <div className="r-card"><span>Yo‘ldagi online buyurtmalar</span><b>{fmt(data.pendingOnline.amount)}</b><small>{data.pendingOnline.count} ta, hali to‘lanmagan</small></div>
          </div>

          <h2 className="a-sub">Qarzdorlar <small>jami {fmt(data.debts.total)} · bugungi holat</small></h2>
          {data.debts.list.length === 0 ? <p className="a-muted">Qarzdor yo‘q.</p> : (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead><tr><th>Mijoz</th><th>№</th><th>Sana</th><th className="r">Jami</th><th className="r">To‘langan</th><th className="r">Qarz</th><th>Muddat</th></tr></thead>
                <tbody>
                  {data.debts.list.map(d => (
                    <tr key={d.no}>
                      <td><b>{d.name || '—'}</b><br /><small>{d.phone}</small></td>
                      <td>{d.no}<br /><small>{d.channel === 'store' ? 'Do‘kon' : 'Sayt'}</small></td>
                      <td className="nw">{showTime(d.createdAt)}</td>
                      <td className="r nw">{fmt(d.total)}</td>
                      <td className="r nw">{fmt(d.paid)}</td>
                      <td className="r nw"><b>{fmt(d.debt)}</b></td>
                      <td className={'nw' + (d.dueDate && d.dueDate < today ? ' a-late' : '')}>{d.dueDate ? showDate(d.dueDate) : '—'}{d.dueDate && d.dueDate < today ? ' · o‘tib ketgan' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="a-sub">Eng ko‘p sotilganlar</h2>
          {data.top.length === 0 ? <p className="a-muted">Bu davrda savdo bo‘lmagan.</p> : (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead><tr><th>Kiyim</th><th className="r">Soni</th><th className="r">Summa</th></tr></thead>
                <tbody>{data.top.map(t => <tr key={t.productId}><td>{t.name}</td><td className="r">{t.qty}</td><td className="r nw">{fmt(t.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
