import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { adminApi, loadCatalog, send, type Catalog, type Discount } from './api'
import { showTime } from './period'

const state = (d: Discount, now = new Date()) =>
  d.endsAt && new Date(d.endsAt) <= now ? 'ended' : d.startsAt && new Date(d.startsAt) > now ? 'soon' : 'on'
const STATE = { on: 'Amalda', soon: 'Boshlanmagan', ended: 'Tugagan' } as const

/** "2026-12-01T09:00" from a datetime-local field -> ISO with the device's offset */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null)

export function Discounts() {
  const [list, setList] = useState<Discount[] | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [scope, setScope] = useState<'product' | 'category'>('category')
  const [targetId, setTargetId] = useState('')
  const [percent, setPercent] = useState('10')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    adminApi<{ discounts: Discount[] }>('/api/admin/discounts').then(r => setList(r.discounts), (e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    load()
    loadCatalog().then(setCatalog, (e: Error) => setError(e.message))
  }, [load])

  const name = useMemo(() => {
    const m = new Map<string, string>()
    catalog?.categories.forEach(c => m.set(`category:${c.id}`, `${c.name} (butun bo‘lim)`))
    catalog?.products.forEach(p => m.set(`product:${p.id}`, p.name))
    return (d: Discount) => m.get(`${d.scope}:${d.targetId}`) ?? d.targetId
  }, [catalog])

  const options = scope === 'category'
    ? (catalog?.categories ?? []).map(c => [c.id, c.name])
    : [...(catalog?.products ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.id, p.name])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await send('POST', '/api/admin/discounts', { scope, targetId, percent: Math.round(Number(percent) || 0), startsAt: toIso(startsAt), endsAt: toIso(endsAt) })
      setTargetId('')
      setStartsAt('')
      setEndsAt('')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (d: Discount) => {
    if (!confirm(`${name(d)} uchun ${d.percent}% chegirma o‘chirilsinmi?`)) return
    try {
      await send('DELETE', `/api/admin/discounts/${d.id}`)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section>
      <div className="a-head"><h1>Chegirmalar</h1></div>
      <form className="a-card a-form" onSubmit={submit}>
        <h2>Yangi chegirma</h2>
        <p className="a-muted">Chegirma saytda, kassada va yorliqlarda avtomatik hisoblanadi. Bitta kiyimga bir nechta chegirma tushsa, eng kattasi olinadi.</p>
        <div className="a-row">
          <label>Nimaga
            <select value={scope} onChange={e => { setScope(e.target.value as 'product' | 'category'); setTargetId('') }}>
              <option value="category">Butun bo‘limga</option>
              <option value="product">Bitta kiyimga</option>
            </select>
          </label>
          <label>{scope === 'category' ? 'Bo‘lim' : 'Kiyim'}
            <select value={targetId} onChange={e => setTargetId(e.target.value)} required>
              <option value="">Tanlang</option>
              {options.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <label>Chegirma, %<input type="number" min={1} max={90} value={percent} onChange={e => setPercent(e.target.value)} required /></label>
        </div>
        <div className="a-row">
          <label>Boshlanishi <small>(bo‘sh bo‘lsa — hozirdan)</small><input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label>
          <label>Tugashi <small>(bo‘sh bo‘lsa — muddatsiz)</small><input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} /></label>
        </div>
        {error && <p className="a-err" role="alert">{error}</p>}
        <div className="a-actions"><button className="a-btn primary" disabled={busy || !targetId}>Chegirmani qo‘shish</button></div>
      </form>

      <h2 className="a-sub">Barcha chegirmalar</h2>
      {!list ? <p className="a-muted">Yuklanmoqda…</p> : list.length === 0 ? <p className="a-muted">Hali chegirma yo‘q.</p> : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Nimaga</th><th className="r">Chegirma</th><th>Muddati</th><th>Holat</th><th /></tr></thead>
            <tbody>
              {list.map(d => {
                const s = state(d)
                return (
                  <tr key={d.id} className={s === 'ended' ? 'is-off' : ''}>
                    <td><b>{name(d)}</b></td>
                    <td className="r"><b>{d.percent}%</b></td>
                    <td className="nw">{d.startsAt ? showTime(d.startsAt) : 'hozirdan'} — {d.endsAt ? showTime(d.endsAt) : 'muddatsiz'}</td>
                    <td><span className={`a-pay ${s === 'on' ? 'paid' : s === 'soon' ? 'partial' : 'unpaid'}`}>{STATE[s]}</span></td>
                    <td className="r"><button className="a-link" onClick={() => remove(d)}>O‘chirish</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
