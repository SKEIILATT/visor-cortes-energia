export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMinute(minute) {
  let m = minute;
  if (m >= 1440) m = 0;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return hh + ':' + mm;
}

export function truncate(value, maxLen) {
  const txt = String(value || '');
  if (txt.length <= maxLen) return txt;
  return txt.slice(0, maxLen - 1) + '...';
}

export function debounce(fn, wait) {
  let timer = null;
  return function () {
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(null, args);
    }, wait);
  };
}

export function toNumber(value) {
  if (typeof value === 'number') return value;
  const txt = String(value || '').trim().replace(',', '.');
  return Number(txt);
}

export function normalizeHeader(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function readFileAsText(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function (ev) { resolve(ev.target.result); };
    r.onerror = function () { reject(new Error('No se pudo leer archivo de texto.')); };
    r.readAsText(file, 'utf-8');
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function (ev) { resolve(ev.target.result); };
    r.onerror = function () { reject(new Error('No se pudo leer archivo binario.')); };
    r.readAsArrayBuffer(file);
  });
}

export function downloadText(fileName, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
}

export function csvCell(value) {
  const txt = String(value === null || value === undefined ? '' : value);
  return '"' + txt.replace(/"/g, '""') + '"';
}

export function setStatus(ctx, text, kind) {
  ctx.els.statusPill.textContent = text;
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  if (kind) ctx.els.statusPill.classList.add(kind);
}
