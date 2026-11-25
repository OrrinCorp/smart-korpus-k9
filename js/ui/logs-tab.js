/* Розділ «Безпека → Журнали»: перегляд і вивантаження CSV
 * (покази датчиків, двері й проходи, тривоги й несправності). */
SK.logsTab = (function () {
  var U = SK.util, B = SK.building, L = SK.logs, DEV = SK.devicesI3, SEC = SK.security, esc = U.esc, $ = U.$;
  var PREVIEW = 60;
  var st = { kind: 'sensors', preset: 'today', from: '', to: '', step: '15', scope: 'all', block: 'A', floor: '2', room: '', device: '',
    kinds: ['temp', 'co2', 'pir', 'counter', 'counterDoor', 'pm', 'leak', 'door'] };
  function D() { return SK.dashboard; }

  function open(o) {
    st.kind = o.kind || st.kind;
    if (o.device) { st.scope = 'device'; st.device = o.device; st.room = o.room || ''; }
    else if (o.room) { st.scope = 'room'; st.room = o.room; st.device = ''; }
    st.preset = 'today';
  }

  function filter() {
    var f = { scope: st.scope, block: st.block, floor: st.floor, room: st.room, device: st.device };
    if (f.scope === 'device' && !f.device) f.scope = f.room ? 'room' : 'all';
    if (f.scope === 'room' && !f.room) f.scope = 'all';
    return f;
  }

  function render(p) {
    var n = D().now(), sel = D().sel, per = L.period(st.preset, n, st.from, st.to), f = filter();
    var mask = !SEC.can('access');
    var rooms = B.rooms.slice().sort(function (a, b) { return a.id.localeCompare(b.id, 'uk'); });
    var h = '<h2>Журнали</h2><div class="muted small">Перегляд і вивантаження у CSV (Excel: UTF-8, роздільник «;»). <span class="demo-badge">симуляція</span></div>';
    h += '<div class="seg lg-seg" role="tablist">' + [['sensors', 'Датчики'], ['doors', 'Двері й проходи'], ['alarms', 'Тривоги й несправності']].map(function (k) {
      return '<button data-lk="' + k[0] + '"' + (st.kind === k[0] ? ' class="on"' : '') + '>' + k[1] + '</button>';
    }).join('') + '</div>';

    /* Форма */
    h += '<div class="ef-row">' + sel('lgPreset', [['today', 'Сьогодні'], ['yesterday', 'Вчора'], ['week', '7 днів'], ['custom', 'Свої дати']], st.preset) +
      (st.preset === 'custom' ? '<input type="date" id="lgFrom" value="' + (st.from || U.dateKey(n)) + '"> — <input type="date" id="lgTo" value="' + (st.to || U.dateKey(n)) + '">' : '') +
      (st.kind === 'sensors' ? sel('lgStep', [['1', 'крок 1 хв'], ['5', 'крок 5 хв'], ['15', 'крок 15 хв'], ['60', 'крок 1 год']], st.step) : '') + '</div>';
    h += '<div class="ef-row">' + sel('lgScope', [['all', 'Увесь корпус'], ['block', 'Блок'], ['floor', 'Поверх'], ['room', 'Приміщення']].concat(st.kind === 'sensors' ? [['device', 'Окремий датчик']] : []), st.scope) +
      (st.scope === 'block' || st.scope === 'floor' ? sel('lgBlock', [['A', 'Блок А'], ['B', 'Блок Б']].concat(st.scope === 'block' ? [['C', 'Перемичка']] : []), st.block) : '') +
      (st.scope === 'floor' ? sel('lgFloor', [0, 1, 2, 3, 4].map(function (x) { return [String(x), 'поверх ' + x]; }), st.floor) : '') +
      (st.scope === 'room' || st.scope === 'device' ? sel('lgRoom', [['', '— приміщення —']].concat(rooms.map(function (r) { return [r.id, r.id + ' · ' + r.name]; })), st.room) : '') +
      (st.scope === 'device' && st.room ? sel('lgDev', [['', '— датчик —']].concat(DEV.devices.filter(function (d) { return d.room === st.room && L.SENSOR_TYPES[d.kind]; }).map(function (d) { return [d.id, L.SENSOR_TYPES[d.kind].name + ' · ' + d.id]; })), st.device) : '') + '</div>';
    if (st.kind === 'sensors') {
      h += '<div class="lg-kinds">' + Object.keys(L.SENSOR_TYPES).map(function (k) {
        return '<label><input type="checkbox" data-lkind="' + k + '"' + (st.kinds.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(L.SENSOR_TYPES[k].name) + '</label>';
      }).join('') + '</div>';
    }

    /* Обсяг і попередній перегляд */
    var head, rows, total, note = '';
    var perTxt = L.fDate(per.from) + ' ' + U.hhmm(per.from) + ' — ' + L.fDate(per.to) + ' ' + U.hhmm(per.to);
    if (st.kind === 'sensors') {
      total = L.sensorCount(per, +st.step, f, st.kinds);
      head = L.SENSOR_HEAD; rows = L.sensorRows(per, +st.step, f, st.kinds, PREVIEW, true);
      if (total > L.MAX_ROWS) note = 'Забагато рядків (' + total.toLocaleString('uk-UA') + ') — у файл потраплять перші ' + L.MAX_ROWS.toLocaleString('uk-UA') + '. Збільште крок або звузьте вибірку.';
      h += '<div class="small" style="margin:6px 0">Датчиків: <b>' + L.sensorDevices(f, st.kinds).length + '</b> · рядків у файлі: <b>' + Math.min(total, L.MAX_ROWS).toLocaleString('uk-UA') + '</b> · ' + perTxt + '</div>';
    } else if (st.kind === 'doors') {
      var all = L.doorRows(per, f, L.MAX_ROWS, true, mask), sm = L.doorSummary(per, f);
      total = all.length; head = L.DOOR_HEAD; rows = all.slice(0, PREVIEW);
      h += '<div class="kpis" style="margin-top:6px">' + D().kpi(sm.opens.toLocaleString('uk-UA'), 'відчинень дверей') + D().kpi(sm.granted.toLocaleString('uk-UA'), 'входів за відбитком') +
        D().kpi(sm.turnstile.toLocaleString('uk-UA'), 'проходів через турнікети') + D().kpi(sm.denied, 'відмов доступу', sm.denied ? 'var(--warn)' : null) +
        D().kpi(sm.long, 'тримали відчиненими > 60 с', sm.long ? 'var(--warn)' : null) + '</div>' +
        '<div class="small" style="margin:6px 0">Подій: <b>' + total.toLocaleString('uk-UA') + '</b> · ' + perTxt + (mask ? ' · ідентифікатори користувачів приховано (потрібна роль адміністратора)' : '') + '</div>';
    } else {
      var al = L.alarmRows(per, f, L.MAX_ROWS, true);
      total = al.length; head = L.ALARM_HEAD; rows = al.slice(0, PREVIEW);
      var crit = al.filter(function (r) { return r[3] === SEC.SEV.critical || r[3] === SEC.SEV.serious; }).length;
      h += '<div class="kpis" style="margin-top:6px">' + D().kpi(total, 'записів') + D().kpi(crit, 'критичні й високі', crit ? 'var(--bad)' : null) +
        D().kpi(al.filter(function (r) { return r[11] === 'аналіз показів датчиків'; }).length, 'епізодів CO₂ ≥ 1000 ppm') + '</div>' +
        '<div class="small" style="margin:6px 0">' + perTxt + ' · джерела: журнал подій системи, аналіз показів датчиків, журнал дверей</div>';
    }
    if (note) h += '<div class="note" style="border-left-color:var(--warn)">' + esc(note) + '</div>';
    h += '<div class="row" style="margin:6px 0 10px"><button class="btn primary" id="lgCsv"' + (total ? '' : ' disabled') + '>' + SK.icon('download', 'ico sm') + 'Завантажити CSV</button>' +
      '<span class="small muted">' + (total ? 'Попередній перегляд: ' + Math.min(PREVIEW, total) + ' найновіших рядків' : 'Немає даних за цей період') + '</span></div>';
    var cols = st.kind === 'sensors' ? [1, 2, 4, 8, 9, 10, 11] : st.kind === 'doors' ? [1, 2, 7, 9, 10, 12, 13] : [0, 1, 2, 3, 4, 7, 8];
    if (rows.length) h += '<div class="tw lg-table"><table class="t"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(head[c]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var cls = st.kind === 'alarms' && (r[3] === SEC.SEV.critical || r[3] === SEC.SEV.serious) ? ' class="bad-row"' : st.kind === 'doors' && (r[10] === 'відмова' || r[13]) ? ' class="warn-row"' : st.kind === 'sensors' && r[11] !== 'норма' ? ' class="warn-row"' : '';
        return '<tr' + cls + '>' + cols.map(function (c) { return '<td class="small">' + esc(r[c] == null ? '' : r[c]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    h += '<details class="sec" data-key="lg-about"><summary><h3>Звідки дані в реальній системі</h3></summary><div class="small muted">' +
      'Покази датчиків надсилають контролери Atom (1-Wire, Modbus RS-485, цифрові входи) у MQTT; сервер «Розумного корпусу» зберігає їх у часовій базі даних (термін зберігання — за політикою закладу). ' +
      'Двері — геркони на цифрових входах Atom Argon і журнал біометричного контролера доступу (шаблони відбитків туди не потрапляють — лише ідентифікатор користувача). ' +
      'Тривоги — журнал подій сервера. У прототипі історію відтворює та сама модель, що й «живі» покази: розклад, сценарії, кількість людей; реальні дії в цьому браузері (спроби доступу, тестові тривоги) додаються як є.</div></details>';
    p.innerHTML = h;

    /* Події форми */
    function set(k, v) { st[k] = v; D().renderPanel(); }
    U.$all('[data-lk]', p).forEach(function (b) { b.onclick = function () { if (st.scope === 'device' && b.dataset.lk !== 'sensors') st.scope = st.room ? 'room' : 'all'; set('kind', b.dataset.lk); }; });
    $('#lgPreset', p).onchange = function (e) { set('preset', e.target.value); };
    var fr = $('#lgFrom', p), to = $('#lgTo', p);
    if (fr) fr.onchange = function (e) { set('from', e.target.value); };
    if (to) to.onchange = function (e) { set('to', e.target.value); };
    var stp = $('#lgStep', p); if (stp) stp.onchange = function (e) { set('step', e.target.value); };
    $('#lgScope', p).onchange = function (e) { set('scope', e.target.value); };
    [['lgBlock', 'block'], ['lgFloor', 'floor'], ['lgRoom', 'room'], ['lgDev', 'device']].forEach(function (x) {
      var el = $('#' + x[0], p); if (el) el.onchange = function (e) { if (x[1] === 'room') st.device = ''; set(x[1], e.target.value); };
    });
    U.$all('[data-lkind]', p).forEach(function (c) {
      c.onchange = function () { var k = c.dataset.lkind, i = st.kinds.indexOf(k); if (c.checked && i < 0) st.kinds.push(k); if (!c.checked && i >= 0) st.kinds.splice(i, 1); D().renderPanel(); };
    });
    $('#lgCsv', p).onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Формую файл…';
      setTimeout(function () {
        var head2, rows2, base;
        if (st.kind === 'sensors') { head2 = L.SENSOR_HEAD; rows2 = L.sensorRows(per, +st.step, f, st.kinds, L.MAX_ROWS, false); base = 'датчики'; }
        else if (st.kind === 'doors') { head2 = L.DOOR_HEAD; rows2 = L.doorRows(per, f, L.MAX_ROWS, false, mask); base = 'двері'; }
        else { head2 = L.ALARM_HEAD; rows2 = L.alarmRows(per, f, L.MAX_ROWS, false); base = 'тривоги'; }
        var where = f.scope === 'all' ? 'корпус' : f.scope === 'block' ? 'блок-' + f.block : f.scope === 'floor' ? f.block + f.floor : f.scope === 'room' ? f.room : f.device;
        L.download('K9_' + base + '_' + where + '_' + U.dateKey(per.from) + (U.dateKey(per.from) !== U.dateKey(new Date(per.to - 1)) ? '_' + U.dateKey(new Date(per.to - 1)) : '') + '.csv', L.csv(head2, rows2));
        U.toast('Файл сформовано: ' + rows2.length.toLocaleString('uk-UA') + ' рядків', 'good');
        D().renderPanel();
      }, 30);
    };
  }

  return { render: render, open: open, state: st };
})();
