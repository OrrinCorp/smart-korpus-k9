/* Студентський застосунок «К9 · Студент» — ОБМЕЖЕНИЙ функціонал:
 * онлайн-розклад групи, «зараз / далі», розклад подій, пошук аудиторії
 * (де вона й що в ній за розкладом), вільні аудиторії, оголошення.
 * Без 3D-карти, датчиків, сценаріїв і безпеки — це лише в панелі адміністрування. */
SK.student = (function () {
  var U = SK.util, B = SK.building, S = SK.schedule, UE = SK.uniEvents, store = SK.store, $ = U.$, esc = U.esc;
  var LKEY = 'sk9_student';
  var me = loadMe();
  var ui = { screen: 'home', day: null, evFilter: 'mine', q: '', found: null, freePair: null, ff: { block: '', floor: '' } };

  function loadMe() { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { return {}; } }
  function saveMe() { try { localStorage.setItem(LKEY, JSON.stringify(me)); } catch (e) { } }
  function now() { return store.clock.now(); }
  function group() { return S.groups.filter(function (g) { return g.id === me.group; })[0]; }
  function mins(d) { return d.getHours() * 60 + d.getMinutes(); }

  function init() {
    $('#groupSel').innerHTML = S.groups.map(function (g) { return '<option value="' + g.id + '">' + g.id + ' — ' + esc(g.specialtyName) + ', ' + g.course + ' курс</option>'; }).join('');
    $('#groupOk').onclick = function () { me.group = $('#groupSel').value; saveMe(); $('#groupModal').hidden = true; render(); };
    if (!me.group) $('#groupModal').hidden = false;
    /* Повернення до панелі: у тій самій вкладці (онлайн-переглядач блокує нові вкладки) */
    $('#backBtn').onclick = function () { if (history.length > 1 && document.referrer) history.back(); else location.href = 'index.html'; };
    $('#sNav').addEventListener('click', function (e) { var b = e.target.closest('button[data-go]'); if (b) go(b.dataset.go); });
    document.body.addEventListener('click', function (e) {
      var t = e.target.closest('[data-room]');
      if (t) { e.preventDefault(); ui.q = t.dataset.room; ui.found = t.dataset.room; go('rooms'); }
    });
    store.on('change', function () { render(true); });
    setInterval(function () { render(true); }, 10000);
    var hs = location.hash.replace('#', '');
    if (/^(home|week|events|rooms|news)$/.test(hs)) go(hs); else render();
  }

  function go(screen) {
    ui.screen = screen;
    U.$all('#sNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.go === screen); });
    U.$all('.screen').forEach(function (s) { s.hidden = s.dataset.screen !== screen; });
    if (screen === 'news') { me.seenNews = store.state.announcements.length; saveMe(); }
    $('.s-main').scrollTop = 0;
    render();
  }

  function render(soft) {
    var n = now();
    $('#sClock').textContent = U.DAYS_SHORT[U.dow(n)] + ' ' + U.hhmm(n);
    $('#sGroupLbl').textContent = me.group ? 'група ' + me.group : 'група не обрана';
    var unseen = store.state.announcements.length - (me.seenNews || 0);
    $('#newsCnt').textContent = unseen; $('#newsCnt').hidden = unseen <= 0 || ui.screen === 'news';
    var ae = document.activeElement;
    if (soft && ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
    var el = $('[data-screen="' + ui.screen + '"]');
    ({ home: home, week: week, events: events, rooms: rooms, news: news })[ui.screen](el, n);
  }

  function myEvents(from, days) { var f = UE.forAudience(me.group); return UE.upcoming(from, days).filter(f); }
  function evCard(e, compact) {
    var d = new Date(e.date + 'T12:00:00');
    return '<div class="card ev"><div class="ev-date"><b>' + d.getDate() + '</b>' + U.DAYS_SHORT[U.dow(d)] + '</div><div class="grow">' +
      '<div class="small muted">' + esc(UE.TYPES[e.type] || '') + ' · ' + e.start + '–' + e.end + '</div><div class="subj">' + esc(e.title) + '</div>' +
      '<div class="small">📍 ' + (e.room ? '<a href="#" data-room="' + e.room + '">' + e.room + '</a> · ' + esc(B.whereText(B.room(e.room))) : esc(e.place)) + '</div>' +
      (!compact && e.desc ? '<div class="small muted">' + esc(e.desc) + '</div>' : '') + '</div></div>';
  }

  /* ---------- Сьогодні ---------- */
  function home(el, n) {
    var g = group(), m = mins(n), d = U.dow(n);
    var list = me.group ? S.groupWeek(me.group).filter(function (l) { return l.day === d; }) : [];
    var cur = list.filter(function (l) { var p = S.PAIRS[l.pair - 1]; return m >= p.s && m < p.e; })[0];
    var next = list.filter(function (l) { return S.PAIRS[l.pair - 1].s > m; })[0];
    var h = '<div class="hello"><div class="mascot"><img src="assets/mascot/shaheda.png" alt="Маскот «Шахеда»" onerror="this.replaceWith(\'Ш\')"></div>' +
      '<div class="bubble">' + greet(n) + (g ? ', <b>' + esc(g.id) + '</b>!' : '!') + ' ' +
      (cur ? 'Зараз ' + cur.pair + '-га пара.' : next ? 'Наступна пара о ' + S.PAIRS[next.pair - 1].start + '.' : list.length ? 'На сьогодні пари завершено.' : 'Сьогодні пар немає.') + '</div></div>';
    if (cur) h += lessonCard(cur, 'Зараз', n, true);
    if (next) h += lessonCard(next, cur ? 'Далі' : 'Наступна пара', n, false);
    var rest = list.filter(function (l) { return l !== cur && l !== next && S.PAIRS[l.pair - 1].s > m; });
    if (rest.length) h += '<h3>Ще сьогодні</h3>' + rest.map(function (l) { return lrow(l, false); }).join('');
    var today = myEvents(n, 0);
    if (today.length) h += '<h3>Події сьогодні</h3>' + today.map(function (e) { return evCard(e, true); }).join('');
    var soon = myEvents(new Date(n.getTime() + 86400000), 6);
    if (soon.length) h += '<h3>Найближчі події</h3>' + soon.slice(0, 2).map(function (e) { return evCard(e, true); }).join('') +
      '<div class="small"><a href="#" onclick="SK.student.go(\'events\');return false">Усі події →</a></div>';
    var an = store.state.announcements[0];
    if (an) h += '<h3>Оголошення</h3><div class="card small"><b>' + esc(an.from) + ':</b> ' + esc(an.text) + '</div>';
    el.innerHTML = h;
  }
  function greet(n) { var h = n.getHours(); return h < 11 ? 'Доброго ранку' : h < 17 ? 'Добрий день' : 'Добрий вечір'; }
  function lessonCard(l, title, n, isNow) {
    var p = S.PAIRS[l.pair - 1], r = B.room(l.room), m = mins(n);
    var h = '<div class="card lesson-big" style="margin-top:12px"><div class="small muted">' + title + ' · ' + l.pair + '-га пара · ' + p.start + '–' + p.end + '</div>' +
      '<div class="row"><a class="room" href="#" data-room="' + l.room + '">' + l.room + '</a></div>' +
      '<div class="subj"><b>' + esc(l.subject) + '</b> · ' + esc(l.kind) + '</div><div class="when">' + esc(l.teacher) + '</div>' +
      '<div class="small" style="margin-top:4px">📍 ' + esc(B.whereText(r)) + '</div>';
    if (S.lessonsAt(l.room, l.day, l.pair).length > 1) h += '<div class="small" style="color:var(--bad)">⚠ Аудиторію уточнюється (зміни в розкладі)</div>';
    if (isNow) h += '<div class="progress"><i style="width:' + Math.round((m - p.s) / (p.e - p.s) * 100) + '%"></i></div><div class="small muted">До кінця: ' + (p.e - m) + ' хв</div>';
    else if (p.s > m) h += '<div class="small muted" style="margin-top:4px">Почнеться через ' + (p.s - m) + ' хв</div>';
    return h + '</div>';
  }
  function lrow(l, isNow) {
    var p = S.PAIRS[l.pair - 1];
    return '<div class="lrow' + (isNow ? ' now' : '') + '"><div class="tm"><b>' + p.start + '</b>' + p.end + '</div><div><div class="subj">' + esc(l.subject) + '</div>' +
      '<div class="small muted">' + esc(l.kind) + ' · ' + esc(l.teacher) + '</div>' +
      (S.lessonsAt(l.room, l.day, l.pair).length > 1 ? '<div class="small" style="color:var(--bad)">⚠ Аудиторію уточнюється</div>' : '') + '</div>' +
      '<a class="chip link" href="#" data-room="' + l.room + '">' + l.room + '</a></div>';
  }

  /* ---------- Розклад ---------- */
  function week(el, n) {
    if (!me.group) { el.innerHTML = '<div class="card">Спочатку оберіть групу.</div>'; return; }
    var d = ui.day || Math.min(U.dow(n), 5), m = mins(n);
    var h = '<div class="days">' + [1, 2, 3, 4, 5].map(function (x) {
      return '<button class="btn small' + (x === d ? ' on' : '') + '" onclick="SK.student.day(' + x + ')">' + U.DAYS_SHORT[x] + (x === U.dow(n) ? ' •' : '') + '</button>';
    }).join('') + '<button class="btn small" onclick="SK.student.changeGroup()">Група: ' + esc(me.group) + '</button></div>';
    var list = S.groupWeek(me.group).filter(function (l) { return l.day === d; });
    h += list.length ? list.map(function (l) { var p = S.PAIRS[l.pair - 1]; return lrow(l, d === U.dow(n) && m >= p.s && m < p.e); }).join('') : '<div class="muted">Пар немає.</div>';
    var mon = new Date(n); mon.setDate(mon.getDate() - (U.dow(n) - 1));
    var dayDate = new Date(mon); dayDate.setDate(mon.getDate() + d - 1);
    var evs = myEvents(dayDate, 0);
    if (evs.length) h += '<h3>Події цього дня</h3>' + evs.map(function (e) { return evCard(e, true); }).join('');
    h += '<div class="small muted" style="margin-top:10px">Розклад демонстраційний. У робочій версії — з офіційної системи розкладу ЧНУ.</div>';
    el.innerHTML = h;
  }

  /* ---------- Події ---------- */
  function events(el, n) {
    var all = UE.upcoming(n, 21), mine = all.filter(UE.forAudience(me.group));
    var list = ui.evFilter === 'mine' ? mine : all;
    var h = '<h2>Розклад подій</h2><div class="days" style="margin-top:8px"><button class="btn small' + (ui.evFilter === 'mine' ? ' on' : '') + '" onclick="SK.student.evf(\'mine\')">Для мене (' + mine.length + ')</button>' +
      '<button class="btn small' + (ui.evFilter === 'all' ? ' on' : '') + '" onclick="SK.student.evf(\'all\')">Усі (' + all.length + ')</button></div>';
    var lastDate = null;
    list.forEach(function (e) {
      if (e.date !== lastDate) {
        var d = new Date(e.date + 'T12:00:00');
        h += '<h3>' + U.DAYS[U.dow(d)] + ', ' + U.pad(d.getDate()) + '.' + U.pad(d.getMonth() + 1) + '</h3>';
        lastDate = e.date;
      }
      h += evCard(e, false);
    });
    if (!list.length) h += '<div class="muted">Найближчими тижнями подій немає.</div>';
    el.innerHTML = h;
  }

  /* ---------- Аудиторії: пошук і вільні ---------- */
  function rooms(el, n) {
    var h = '<h2>Знайти аудиторію</h2><form class="row" onsubmit="SK.student.find(event)" style="margin:8px 0"><input type="text" id="rq" class="grow" placeholder="Номер, напр. А-305 або Б-110" value="' + esc(ui.q) + '" autocomplete="off">' +
      '<button class="btn primary small">Знайти</button></form>';
    if (ui.found) {
      var r = B.room(ui.found);
      h += '<div class="card"><div class="row"><h2>' + r.id + '</h2><span class="grow"></span><button class="btn small" onclick="SK.student.clear()" aria-label="Закрити">✕</button></div>' +
        '<div class="small muted">' + esc(r.name) + (r.capacity ? ' · ' + r.capacity + ' місць' : '') + '</div>' +
        '<div style="margin-top:6px">📍 ' + esc(B.whereText(r)) + '</div>' +
        '<div class="small muted">Вхід — головний, під перемичкою' + (r.floor > 0 ? '; сходами на ' + r.floor + ' поверх' : '') + '. Біля сходів — інфотабло з розкладом.</div>' +
        nearby(r);
      if (r.bookable) {
        var s = S.status(r.id, n);
        h += '<div style="margin-top:8px"><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>' +
          (s.lesson ? ' · ' + esc(s.lesson.subject) + ' (' + esc(s.lesson.group) + ')' : s.booking ? ' · ' + esc(s.booking.purpose) : '') + '</div><h3>Сьогодні в ' + r.id + '</h3><div class="pairs">';
        S.roomDay(r.id, n).forEach(function (row) {
          var l = row.lessons[0];
          h += '<span>' + row.pair.n + '. ' + row.pair.start + '</span><span>' + (l ? esc(l.subject) + ' · ' + esc(l.group) : row.booking ? esc(row.booking.purpose) : '<span class="muted">вільно</span>') + '</span>';
        });
        h += '</div>';
      }
      h += '</div>';
    }
    var cur = S.pairAt(n), nx = S.nextPair(n), m = mins(n);
    var p = ui.freePair || (cur ? cur.n : nx ? nx.n : 1), ff = ui.ff;
    h += '<h3>Вільні аудиторії сьогодні</h3><div class="days">' + S.PAIRS.map(function (x) {
      return '<button class="btn small' + (x.n === p ? ' on' : '') + '"' + (x.e <= m ? ' disabled' : '') + ' onclick="SK.student.pair(' + x.n + ')">' + x.n + ' · ' + x.start + '</button>';
    }).join('') + '</div><div class="row" style="margin-bottom:6px">' +
      sel('fBlock', [['', 'Усі блоки'], ['A', 'Блок А'], ['B', 'Блок Б']], ff.block) +
      sel('fFloor', [['', 'Усі поверхи'], ['1', '1 пов.'], ['2', '2 пов.'], ['3', '3 пов.'], ['4', '4 пов.']], ff.floor) + '</div>';
    var free = S.freeRooms(n, p, ff);
    h += '<div class="small muted">Вільно: ' + free.length + '. Бронювання — через старосту або адміністрацію корпусу.</div>' + free.slice(0, 40).map(function (r) {
      return '<div class="frow"><div class="top"><a class="id" href="#" data-room="' + r.id + '">' + r.id + '</a><span class="small muted">' + esc(B.types[r.type].name) + ' · ' + r.capacity + ' місць</span></div>' +
        '<div class="small muted">' + esc(B.whereText(r)) + '</div></div>';
    }).join('');
    el.innerHTML = h;
    ['Block', 'Floor'].forEach(function (k) { $('#f' + k, el).onchange = function (e) { ui.ff[k.toLowerCase()] = e.target.value; render(); }; });
  }
  /* Найближчі санвузли й кімната для куріння на тому ж поверсі блоку */
  function nearby(r) {
    var blk = r.block === 'C' ? 'A' : r.block, same = B.rooms.filter(function (x) { return x.block === blk && x.floor === r.floor; });
    var wc = same.filter(function (x) { return x.type === 'wc'; }).map(function (x) { return x.id + ' (' + (/жін/.test(x.name) ? 'Ж' : 'Ч') + ')'; });
    var sm = same.filter(function (x) { return x.type === 'smoking'; }).map(function (x) { return x.id; });
    return '<div class="small" style="margin-top:6px">🚻 Санвузли на поверсі: ' + (wc.join(', ') || '—') +
      (sm.length ? ' · 🚬 Кімната для куріння: ' + sm.join(', ') : '') + '</div>';
  }
  function sel(id, opts, val) {
    return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function normalize(q) {
    var m = /([АБПABPабпabp])\s*[-_ ]?\s*(\d{3})/.exec(q || '');
    if (!m) return null;
    var L = { A: 'А', B: 'Б', P: 'П', a: 'А', b: 'Б', p: 'П', 'а': 'А', 'б': 'Б', 'п': 'П' }[m[1]] || m[1];
    return L + '-' + m[2];
  }

  /* ---------- Новини ---------- */
  function news(el, n) {
    var h = '<h2>Оголошення</h2>' + store.state.announcements.map(function (a) {
      return '<div class="card"><div class="small muted">' + U.fmtDateTime(new Date(a.ts)) + ' · ' + esc(a.from) + '</div>' + esc(a.text) + '</div>';
    }).join('');
    var cf = S.conflicts().filter(function (c) { return c.lessons.some(function (l) { return l.group === me.group; }); });
    if (cf.length) h += '<h3>Зміни для вашої групи</h3>' + cf.map(function (c) {
      var l = c.lessons[0];
      return '<div class="card small">⚠ ' + U.DAYS[l.day] + ', ' + l.pair + '-га пара: аудиторію ' + l.room + ' уточнюється.</div>';
    }).join('');
    h += '<h3>Про застосунок</h3><div class="small muted">Онлайн-розклад, розклад подій і оголошення корпусу № 9 ЧНУ (прототип команди «Ша-Пі-То»). Дані демонстраційні; персональні дані не використовуються.</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small" onclick="SK.student.changeGroup()">Змінити групу</button></div>';
    el.innerHTML = h;
  }

  return {
    init: init, go: go,
    day: function (d) { ui.day = d; render(); },
    evf: function (f) { ui.evFilter = f; render(); },
    pair: function (p) { ui.freePair = p; render(); },
    find: function (e) {
      e.preventDefault(); ui.q = $('#rq').value; var id = normalize(ui.q);
      if (id && B.room(id)) { ui.found = id; render(); } else U.toast('Аудиторію «' + ui.q + '» не знайдено. Приклад: А-305, Б-110', 'warn');
    },
    clear: function () { ui.found = null; ui.q = ''; render(); },
    changeGroup: function () { $('#groupSel').value = me.group || S.groups[0].id; $('#groupModal').hidden = false; }
  };
})();

document.addEventListener('DOMContentLoaded', SK.student.init);
