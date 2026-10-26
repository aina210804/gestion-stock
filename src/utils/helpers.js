const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

function fmtDateTime(d = new Date()) {
  const x = new Date(d);
  return `${fmtDate(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}

function addDays(date, days) {
  const x = new Date(date);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonths(date, months) {
  const x = new Date(date);
  x.setMonth(x.getMonth() + months);
  return x;
}

function monthsAgo(months) {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setMonth(x.getMonth() - months);
  return x;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function toCSV(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';')];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c])).join(';'));
  return '﻿' + lines.join('\r\n');
}

function page(limit, offset) {
  const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const o = Math.max(parseInt(offset, 10) || 0, 0);
  return { limit: l, offset: o };
}

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { fmtDate, fmtDateTime, addDays, addMonths, monthsAgo, round2, toCSV, page, ah, pad };
