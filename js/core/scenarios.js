/* Адміністрування сценаріїв «розумних» приміщень.
 *
 * Сценарій — набір параметрів (світло, жалюзі, проєктор, онлайн-дошка, уставка
 * температури, вентиляція, ПК, режим дверей). Правило — коли й де сценарій
 * діє: за розкладом, за присутністю, за відсутністю людей N хв, за часом і
 * днями, під час відключення електроенергії, вручну. Правила мають пріоритет:
 * для кожного приміщення діє правило з найвищим пріоритетом, що спрацювало.
 *
 * Конфігурацію редагує адміністратор у панелі (вкладка «Сценарії»); вона
 * зберігається в стані (state.scenarioCfg). На контролерах Atom ті самі
 * сценарії налаштовуються в i3 Home; сервер надсилає команду через MQTT.
 */
SK.scenarios = (function () {
  var U = SK.util;

  var PARAMS = {
    light:     { name: 'Світло', unit: '%', type: 'num', min: 0, max: 100, step: 10 },
    blinds:    { name: 'Жалюзі', type: 'opt', opts: { open: 'відкриті', half: 'напівзакриті', closed: 'закриті' } },
    projector: { name: 'Проєктор', type: 'bool' },
    board:     { name: 'Онлайн-дошка', type: 'bool' },
    hvac:      { name: 'Уставка', unit: '°C', type: 'num', min: 14, max: 26, step: 0.5 },
    vent:      { name: 'Вентиляція', type: 'opt', opts: { auto: 'за CO₂', boost: 'посилена', min: 'мінімальна', off: 'вимкнена' } },
    pcs:       { name: 'ПК', type: 'opt', opts: { on: 'увімкнені', standby: 'сон', off: 'вимкнені' } },
    lock:      { name: 'Двері', type: 'opt', opts: { schedule: 'за правами доступу', open: 'відчинені', locked: 'зачинені' } }
  };

  var RULE_TYPES = {
    power:    { name: 'Відключення електроенергії', desc: 'Діє, поки корпус живиться від ДБЖ/генератора' },
    manual:   { name: 'Ручне керування', desc: 'Сценарій, призначений адміністратором чи відповідальною особою (з терміном дії)' },
    time:     { name: 'За часом і днями', desc: 'Дні тижня та інтервал часу (можна через північ)' },
    schedule: { name: 'За розкладом', desc: 'Під час пари, бронювання чи події, а також за N хв до початку' },
    presence: { name: 'Є присутність', desc: 'PIR-датчик фіксує людей поза розкладом' },
    empty:    { name: 'Немає людей N хв', desc: 'Після N хв без руху; до того зберігає попередній сценарій' }
  };

  function defaults() {
    return {
      scenarios: [
        { id: 'lesson', name: 'Заняття', system: true, p: { light: 100, blinds: 'open', projector: true, board: true, hvac: 21, vent: 'auto', pcs: 'on', lock: 'open' } },
        { id: 'presentation', name: 'Презентація', system: true, p: { light: 30, blinds: 'closed', projector: true, board: true, hvac: 21, vent: 'auto', pcs: 'on', lock: 'open' } },
        { id: 'exam', name: 'Іспит / контрольна', p: { light: 100, blinds: 'half', projector: false, board: false, hvac: 20.5, vent: 'auto', pcs: 'on', lock: 'schedule' } },
        { id: 'empty', name: 'Немає людей', system: true, p: { light: 0, blinds: 'open', projector: false, board: false, hvac: 19.5, vent: 'min', pcs: 'off', lock: 'schedule' } },
        { id: 'night', name: 'Неробочий час', system: true, p: { light: 0, blinds: 'closed', projector: false, board: false, hvac: 18, vent: 'off', pcs: 'off', lock: 'locked' } },
        { id: 'blackout', name: 'Резервне живлення', system: true, p: { light: 30, blinds: 'open', projector: false, board: false, hvac: 16, vent: 'off', pcs: 'off', lock: 'schedule' } }
      ],
      rules: [
        { id: 'r-power', name: 'Відключення електроенергії', type: 'power', sc: 'blackout', prio: 100, on: true, target: {} },
        { id: 'r-manual', name: 'Ручне керування', type: 'manual', prio: 90, on: true, system: true, target: {} },
        { id: 'r-wed', name: 'Середа, 5-та пара: презентації в залі', type: 'time', sc: 'presentation', prio: 70, on: true,
          days: [3], from: '14:40', to: '16:00', target: { rooms: ['Б-110'] } },
        { id: 'r-lesson', name: 'Заняття за розкладом', type: 'schedule', sc: 'lesson', prio: 50, on: true, before: 10, target: {} },
        { id: 'r-presence', name: 'Люди поза розкладом', type: 'presence', sc: 'lesson', prio: 45, on: true, target: {} },
        { id: 'r-empty', name: 'Автовимкнення без людей', type: 'empty', sc: 'empty', hold: 'lesson', prio: 40, on: true, minutes: 10, target: {} },
        { id: 'r-night', name: 'Нічний режим', type: 'time', sc: 'night', prio: 42, on: true, days: [1, 2, 3, 4, 5, 6, 7], from: '20:00', to: '07:00', target: {} }
      ]
    };
  }

  var DEF = defaults();
  function cfg() { return SK.store.state.scenarioCfg || DEF; }
  /* Перший запис адміністратора — копіюємо типову конфігурацію в стан */
  function editable() {
    var st = SK.store.state;
    if (!st.scenarioCfg) st.scenarioCfg = JSON.parse(JSON.stringify(DEF));
    return st.scenarioCfg;
  }
  function list() { return cfg().scenarios; }
  function get(id) { return list().filter(function (s) { return s.id === id; })[0] || list().filter(function (s) { return s.id === 'empty'; })[0]; }
  function rules() { return cfg().rules.slice().sort(function (a, b) { return b.prio - a.prio; }); }

  function toMin(hm) { var a = String(hm || '0:0').split(':'); return +a[0] * 60 + +a[1]; }
  function inWindow(m, from, to) { var a = toMin(from), b = toMin(to); return a <= b ? m >= a && m < b : m >= a || m < b; }

  function matchTarget(t, room) {
    if (!t) return true;
    if (t.rooms && t.rooms.length && t.rooms.indexOf(room.id) < 0) return false;
    if (t.blocks && t.blocks.length && t.blocks.indexOf(room.block) < 0) return false;
    if (t.floors && t.floors.length && t.floors.indexOf(room.floor) < 0) return false;
    if (t.types && t.types.length && t.types.indexOf(room.type) < 0) return false;
    return true;
  }

  function override(roomId, date) {
    var o = SK.store.state.overrides[roomId];
    if (!o) return null;
    if (typeof o === 'string') o = { sc: o };          // сумісність зі старим форматом
    if (o.until && date.getTime() > o.until) return null;
    return o;
  }

  /* Головна функція: який сценарій діє в приміщенні.
     ctx = {m (хв доби), day, people, cur (поточний сегмент присутності), next, last} */
  function resolve(room, date, ctx) {
    var rs = rules();
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!r.on || !matchTarget(r.target, room)) continue;
      switch (r.type) {
        case 'power':
          if (SK.power && SK.power.isOutage(date)) return { sc: get(r.sc), rule: r };
          break;
        case 'manual':
          var o = ctx.ignoreManual ? null : override(room.id, date);
          if (o) return { sc: get(o.sc), rule: r, manual: o };
          break;
        case 'time':
          if ((r.days || []).indexOf(ctx.day) >= 0 && inWindow(ctx.m, r.from, r.to)) return { sc: get(r.sc), rule: r };
          break;
        case 'schedule':
          if (ctx.cur || (ctx.next && ctx.next.s - ctx.m <= (r.before || 0) && ctx.next.s > ctx.m)) return { sc: get(r.sc), rule: r };
          break;
        case 'presence':
          if (ctx.people > 0) return { sc: get(r.sc), rule: r };
          break;
        case 'empty':
          if (ctx.people > 0) break;
          if (ctx.last && ctx.m - ctx.last.e < (r.minutes || 10)) return { sc: get(r.hold || 'lesson'), rule: r, hold: true };
          return { sc: get(r.sc), rule: r };
      }
    }
    return { sc: get('empty'), rule: null };
  }

  /* ---------- Адміністрування ---------- */
  function log(text) {
    var st = SK.store.state;
    st.scLog.unshift({ ts: SK.store.clock.now().getTime(), text: text, by: SK.security ? SK.security.ROLES[st.role].name : '' });
    if (st.scLog.length > 100) st.scLog.length = 100;
  }
  function saveScenario(s) {
    var c = editable(), ex = c.scenarios.filter(function (x) { return x.id === s.id; })[0];
    if (ex) { ex.name = s.name; ex.p = s.p; log('Змінено сценарій «' + s.name + '»'); }
    else { s.id = s.id || U.uid('sc'); c.scenarios.push(s); log('Створено сценарій «' + s.name + '»'); }
    SK.store.save();
    return s.id;
  }
  function deleteScenario(id) {
    var c = editable(), s = get(id);
    if (s.system) return 'Системний сценарій не можна видалити.';
    if (c.rules.some(function (r) { return r.sc === id || r.hold === id; })) return 'Сценарій використовується в правилах.';
    c.scenarios = c.scenarios.filter(function (x) { return x.id !== id; });
    log('Видалено сценарій «' + s.name + '»'); SK.store.save();
    return null;
  }
  function saveRule(r) {
    var c = editable(), i = -1;
    c.rules.forEach(function (x, k) { if (x.id === r.id) i = k; });
    if (i >= 0) { c.rules[i] = r; log('Змінено правило «' + r.name + '»'); }
    else { r.id = U.uid('r'); c.rules.push(r); log('Створено правило «' + r.name + '»'); }
    SK.store.save();
  }
  function deleteRule(id) {
    var c = editable(), r = c.rules.filter(function (x) { return x.id === id; })[0];
    if (!r || r.system) return 'Системне правило не можна видалити.';
    c.rules = c.rules.filter(function (x) { return x.id !== id; });
    log('Видалено правило «' + r.name + '»'); SK.store.save();
    return null;
  }
  function toggleRule(id) {
    var c = editable(), r = c.rules.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    r.on = !r.on; log((r.on ? 'Увімкнено' : 'Вимкнено') + ' правило «' + r.name + '»'); SK.store.save();
  }
  /* Ручний сценарій для набору приміщень; minutes = null — до скасування */
  function apply(roomIds, scId, minutes) {
    var st = SK.store.state, until = minutes ? SK.store.clock.now().getTime() + minutes * 60000 : null;
    roomIds.forEach(function (id) {
      if (scId === 'auto') delete st.overrides[id];
      else st.overrides[id] = { sc: scId, until: until };
    });
    log((scId === 'auto' ? 'Повернуто автоматику: ' : 'Ручний сценарій «' + get(scId).name + '»' + (minutes ? ' на ' + minutes + ' хв' : '') + ': ') +
      (roomIds.length > 3 ? roomIds.length + ' приміщень' : roomIds.join(', ')));
    SK.store.save();
  }
  function reset() { SK.store.state.scenarioCfg = null; log('Відновлено типову конфігурацію сценаріїв'); SK.store.save(); }

  function describeRule(r) {
    var t = r.target || {}, parts = [];
    if (r.type === 'time') parts.push((r.days || []).map(function (d) { return U.DAYS_SHORT[d]; }).join(', ') + ' ' + r.from + '–' + r.to);
    if (r.type === 'schedule' && r.before) parts.push('за ' + r.before + ' хв до початку');
    if (r.type === 'empty') parts.push(r.minutes + ' хв без руху');
    var where = [];
    if (t.rooms && t.rooms.length) where.push(t.rooms.join(', '));
    if (t.blocks && t.blocks.length) where.push('блок ' + t.blocks.map(function (b) { return b === 'A' ? 'А' : b === 'B' ? 'Б' : 'П'; }).join('/'));
    if (t.floors && t.floors.length) where.push('пов. ' + t.floors.join(', '));
    if (t.types && t.types.length) where.push(t.types.map(function (x) { return SK.building.types[x].name.toLowerCase(); }).join(', '));
    parts.push(where.length ? where.join('; ') : 'усі приміщення');
    return parts.join(' · ');
  }

  return { PARAMS: PARAMS, RULE_TYPES: RULE_TYPES, list: list, get: get, rules: rules, resolve: resolve, override: override,
    saveScenario: saveScenario, deleteScenario: deleteScenario, saveRule: saveRule, deleteRule: deleteRule, toggleRule: toggleRule,
    apply: apply, reset: reset, describeRule: describeRule, matchTarget: matchTarget };
})();
