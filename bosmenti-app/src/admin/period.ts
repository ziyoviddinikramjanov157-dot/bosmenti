/* Date ranges are cut at midnight on this device's clock, i.e. the shop's local time. */

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'all' | 'custom'

export const PERIODS: [PeriodKey, string][] = [
  ['today', 'Bugun'],
  ['yesterday', 'Kecha'],
  ['week', '7 kun'],
  ['month', 'Shu oy'],
  ['lastMonth', 'O‘tgan oy'],
]

const day = (d: Date, add = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + add)

export function periodRange(key: PeriodKey, custom?: { from: string; to: string }): { from: string; to: string } | null {
  const now = new Date()
  const today = day(now)
  switch (key) {
    case 'today': return { from: today.toISOString(), to: day(now, 1).toISOString() }
    case 'yesterday': return { from: day(now, -1).toISOString(), to: today.toISOString() }
    case 'week': return { from: day(now, -6).toISOString(), to: day(now, 1).toISOString() }
    case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: day(now, 1).toISOString() }
    case 'lastMonth': return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
    case 'custom': {
      if (!custom?.from || !custom.to) return null
      const [fy, fm, fd] = custom.from.split('-').map(Number)
      const [ty, tm, td] = custom.to.split('-').map(Number)
      return { from: new Date(fy, fm - 1, fd).toISOString(), to: new Date(ty, tm - 1, td + 1).toISOString() }
    }
    case 'all': return null
  }
}

export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const showTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "2026-12-15" -> "15.12.2026" */
export const showDate = (ymd: string) => ymd.split('-').reverse().join('.')
