/* Розумний корпус К9 — спільні утиліти.
 * Увесь код працює без збирача: звичайні <script>, глобальний простір імен SK.
 * Так прототип відкривається подвійним кліком по index.html (file://) без сервера. */
window.SK = window.SK || {};
/* Іконка живлення (SVG): символ ⏻ відсутній у стандартних шрифтах Windows */
SK.PWR_ICON = '<svg class="ico-pwr" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3v8" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/><path d="M6.2 6.6a8 8 0 1 0 11.6 0" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>';

SK.util = (function () {
  /* Детермінований хеш рядка → [0,1). Потрібен, щоб усі вкладки (панель і
     студентський додаток) бачили однакові симульовані значення без сервера. */
  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /* Простий сідований ГПВЧ (mulberry32) для генерації демо-даних. */
  function rng(seed) {
    var a = Math.floor(hash01(String(seed)) * 4294967296);
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function minToHHMM(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtDateTime(d) {
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + hhmm(d);
  }
  /* День тижня 1..7 (Пн..Нд) */
  function dow(d) { var x = d.getDay(); return x === 0 ? 7 : x; }
  var DAYS = ['', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота', 'Неділя'];
  var DAYS_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round(v, n) { var k = Math.pow(10, n || 0); return Math.round(v * k) / k; }
  function fmt(v, n) { return round(v, n).toLocaleString('uk-UA', { minimumFractionDigits: n || 0, maximumFractionDigits: n || 0 }); }

  /* Лінійна інтерполяція кольорів для теплових шкал */
  function lerpColor(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function scale(stops, v) { /* stops: [[value, color], ...] за зростанням */
    if (v <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        var t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        return lerpColor(stops[i - 1][1], stops[i][1], t);
      }
    }
    return stops[stops.length - 1][1];
  }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }

  function toast(text, kind) {
    var box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 4200);
    setTimeout(function () { t.remove(); }, 4800);
  }

  return {
    hash01: hash01, rng: rng, pad: pad, hhmm: hhmm, minToHHMM: minToHHMM, dateKey: dateKey,
    fmtDateTime: fmtDateTime, dow: dow, DAYS: DAYS, DAYS_SHORT: DAYS_SHORT, esc: esc, $: $, $all: $all,
    uid: uid, clamp: clamp, round: round, fmt: fmt, lerpColor: lerpColor, scale: scale, hex: hex, toast: toast
  };
})();
