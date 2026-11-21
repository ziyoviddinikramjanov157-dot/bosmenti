import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { asset } from '../lib/api'
import { fmt } from '../lib/util'
import type { AdminOrder, Label, Settings } from './api'

/**
 * USB barcode scanners act like a keyboard: they type the code very fast and press Enter.
 * Keys that arrive faster than a person types are collected into one code, wherever the focus is,
 * so a scan never ends up in the wrong field.
 */
export function useScanner(onScan: (code: string) => void, enabled = true) {
  const cb = useRef(onScan)
  cb.current = onScan
  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let last = 0
    // the first key of a scan looks like normal typing, so it may land in a text field
    let leaked: HTMLInputElement | HTMLTextAreaElement | null = null
    const onKey = (e: KeyboardEvent) => {
      const now = performance.now()
      const fast = now - last < 50
      last = now
      if (e.key === 'Enter') {
        if (buf.length >= 4 && fast) {
          e.preventDefault()
          e.stopPropagation()
          if (leaked?.value.endsWith(buf[0])) setValue(leaked, leaked.value.slice(0, -1))
          cb.current(buf)
        }
        buf = ''
        leaked = null
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        buf = ''
        return
      }
      if (fast && buf) {
        e.preventDefault()
        buf += e.key
        return
      }
      buf = e.key
      const t = e.target
      leaked = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t : null
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [enabled])
}

/** Changes a React-controlled field so React sees the change too. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Short beep: high for a good scan, low for a problem. Needs no sound files. */
export function beep(ok = true) {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1500 : 300
    g.gain.value = 0.08
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3))
    o.onended = () => ctx.close()
  } catch {
    /* no audio on this device */
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const time = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Prints a small HTML page (receipt or labels) through a hidden frame, so the screen itself is not printed. */
export function printHtml(body: string, widthMm: number) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:0}
    *{box-sizing:border-box}
    body{margin:0;width:${widthMm}mm;padding:3mm;font:12px/1.35 Arial,sans-serif;color:#000}
    h1{font-size:16px;margin:0 0 2px;text-align:center}
    .c{text-align:center}.r{text-align:right}.b{font-weight:700}
    .row{display:flex;justify-content:space-between;gap:6px}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .it{margin:4px 0}.sm{font-size:11px}
    .lbl{page-break-inside:avoid;break-inside:avoid;padding:2mm 0;border-bottom:1px dashed #000;text-align:center}
    .lbl svg{width:100%;height:auto;display:block}
  </style></head><body>${body}</body></html>`)
  doc.close()
  const done = () => setTimeout(() => frame.remove(), 1000)
  frame.contentWindow!.onafterprint = done
  setTimeout(() => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    done()
  }, 150)
}

const payLine = (m: 'cash' | 'card') => (m === 'cash' ? 'Naqd' : 'Karta')

export function receiptHtml(o: AdminOrder, s: Settings, change = 0) {
  const lines = o.items.map(i => `
    <div class="it"><div>${esc(i.name)}</div>
      <div class="row sm"><span>${esc(i.color)}, ${esc(i.size)} · ${i.qty} × ${fmt(i.price)}</span><span>${fmt(i.price * i.qty)}</span></div>
      ${i.basePrice > i.price ? `<div class="sm">Chegirma: ${fmt((i.basePrice - i.price) * i.qty)}</div>` : ''}
    </div>`).join('')
  const pays = o.payments.map(p => `<div class="row"><span>${payLine(p.method)}</span><span>${fmt(p.amount)}</span></div>`).join('')
  return `
    <h1>Bosmenti</h1>
    <div class="c sm">Erkaklar kiyim do‘koni</div>
    ${s.address ? `<div class="c sm">${esc(s.address)}</div>` : ''}
    ${s.phone ? `<div class="c sm">${esc(s.phone)}</div>` : ''}
    <hr><div class="row"><span>Savdo № ${o.no}</span><span>${time(o.createdAt)}</span></div>
    ${o.name ? `<div>Mijoz: ${esc(o.name)}${o.phone ? `, ${esc(o.phone)}` : ''}</div>` : ''}
    <hr>${lines}<hr>
    ${o.discountTotal ? `<div class="row"><span>Chegirma</span><span>−${fmt(o.discountTotal)}</span></div>` : ''}
    <div class="row b"><span>JAMI</span><span>${fmt(o.total)}</span></div>
    ${pays}
    ${change > 0 ? `<div class="row"><span>Qaytim</span><span>${fmt(change)}</span></div>` : ''}
    ${o.debt > 0 ? `<div class="row b"><span>Qarz</span><span>${fmt(o.debt)}</span></div>${o.dueDate ? `<div class="sm">To‘lash muddati: ${o.dueDate.split('-').reverse().join('.')}</div>` : ''}` : ''}
    <hr><div class="c">Xaridingiz uchun rahmat!</div>
    <div class="c sm">Yorlig‘i olinmagan kiyim 14 kun ichida almashtiriladi</div>`
}

function barcodeSvg(code: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const ean = /^\d{13}$/.test(code)
  try {
    JsBarcode(svg, code, { format: ean ? 'EAN13' : 'CODE128', height: 46, margin: 0, fontSize: 13, width: 1.6 })
  } catch {
    JsBarcode(svg, code, { format: 'CODE128', height: 46, margin: 0, fontSize: 13, width: 1.6 })
  }
  return svg.outerHTML
}

export function labelsHtml(labels: Label[]) {
  return labels
    .flatMap(l => Array.from({ length: l.copies }, () => `
      <div class="lbl"><div class="b">${esc(l.name)}</div>
        <div class="sm">${esc(l.color)} · ${esc(l.size)}</div>
        ${barcodeSvg(l.code)}
        <div class="b">${fmt(l.price)}</div></div>`))
    .join('')
}

export { asset }
