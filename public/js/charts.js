import { esc, fmtN } from './ui.js';

const COLORS = ['#2f6fed', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#64748b'];

// Courbe / lignes superposées
export function lineChart(container, { labels = [], series = [], height = 220, yFmt = (v) => fmtN(v) }) {
  const w = 720;
  const h = height;
  const pad = { l: 46, r: 12, t: 14, b: 30 };
  const all = series.flatMap((s) => s.data);
  const max = Math.max(1, ...all);
  const n = Math.max(labels.length, 2);
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / (n - 1);
  const y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((p) => {
      const yy = pad.t + p * (h - pad.t - pad.b);
      const val = Math.round(max * (1 - p));
      return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="#eef1f6"/>
              <text x="${pad.l - 7}" y="${yy + 4}" font-size="10" fill="#94a0b8" text-anchor="end">${yFmt(val)}</text>`;
    })
    .join('');

  const xLabels = labels
    .map((l, i) => {
      const step = Math.ceil(labels.length / 8);
      if (i % step !== 0 && i !== labels.length - 1) return '';
      return `<text x="${x(i)}" y="${h - 10}" font-size="10" fill="#94a0b8" text-anchor="middle">${esc(String(l))}</text>`;
    })
    .join('');

  const paths = series
    .map((s, si) => {
      const color = s.color || COLORS[si % COLORS.length];
      const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      const area =
        series.length === 1
          ? `<polygon points="${pad.l},${y(0)} ${pts} ${x(s.data.length - 1)},${y(0)}" fill="${color}" opacity=".08"/>`
          : '';
      const dots = s.data.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${color}"><title>${esc(labels[i])} : ${yFmt(v)}</title></circle>`).join('');
      return `${area}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}`;
    })
    .join('');

  const legend = series.length
    ? `<div class="legend">${series
        .map((s, i) => `<span><i style="background:${s.color || COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`)
        .join('')}</div>`
    : '';

  container.innerHTML = `<div class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${xLabels}${paths}</svg></div>${legend}`;
}

// Barres horizontales simples (top consommation, priorités...)
export function hBars(container, rows, { color = '#2f6fed', fmt = (v) => fmtN(v) } = {}) {
  if (!rows.length) {
    container.innerHTML = '<div class="empty">Aucune donnée</div>';
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  container.innerHTML = `<div class="bars-h">${rows
    .map(
      (r, i) => `<div class="bar-row">
        <div class="bar-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%;background:${r.color || (Array.isArray(color) ? color[i % color.length] : color)}"></div></div>
        <div class="bar-val">${fmt(r.value)}</div>
      </div>`
    )
    .join('')}</div>`;
}

// Camembert (donut) : répartition état du stock
export function donut(container, items, { size = 160, thickness = 22, center = '', sub = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = items
    .map((it, i) => {
      const frac = it.value / total;
      const dash = frac * c;
      const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${it.color || COLORS[i % COLORS.length]}" stroke-width="${thickness}"
        stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(it.label)} : ${it.value}</title></circle>`;
      offset += dash;
      return el;
    })
    .join('');

  const legend = items
    .map(
      (it, i) =>
        `<span><i style="background:${it.color || COLORS[i % COLORS.length]}"></i>${esc(it.label)} : <b>${fmtN(it.value)}</b></span>`
    )
    .join('');

  container.innerHTML = `
    <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef1f6" stroke-width="${thickness}"/>
        ${circles}
        <text x="50%" y="48%" text-anchor="middle" font-size="19" font-weight="700" fill="#1e2433">${esc(center)}</text>
        <text x="50%" y="62%" text-anchor="middle" font-size="10.5" fill="#6b7488">${esc(sub)}</text>
      </svg>
      <div class="legend" style="flex-direction:column;gap:7px">${legend}</div>
    </div>`;
}

// Mini sparkline (inline)
export function spark(data, w = 130, h = 34, color = '#2f6fed') {
  if (!data || data.length < 2) return '';
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return `<svg width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
