/* Керування з диспетчерської (адміністративне приміщення А-001).
 *
 * Будь-яка дія — ручне вимкнення пристрою, відкриття дверей, вимкнення приміщення
 * чи поверху — це КОМАНДА, яка проходить реальний шлях:
 *   оператор (А-001) → сервер «Розумного корпусу» (А-002) → MQTT  chnu/k9/.../set
 *   → шафа ЩА поверху → контролер Atom (порт) → пристрій → підтвердження стану (≤ 2 с).
 * Якщо шафа знеструмлена, контролер offline або немає зв'язку з шафою —
 * команда «не доставлена», причина пишеться в журнал команд і журнал подій.
 *
 * Обмеження безпеки:
 *  - двері на шляхах евакуації розблоковує сертифікована пожежна система, не диспетчер;
 *  - дистанційне відкриття закритих зон (серверна, електрощитова) — лише адміністратор і з причиною;
 *  - ручне вимкнення має пріоритет над сценаріями, доки його не скасують (видно в журналі).
 */
SK.control = (function () {
  var REG = SK.devicesI3, SEC = SK.security, U = SK.util;

  /* Що можна вимкнути вручну (power) і що — вивести з роботи на обслуговування (service) */
  var POWER = { light: 1, hvac: 1, blinds: 1, sockets: 1, board: 1, signage: 1, exhaust: 1, panel: 1, pole: 1, bench: 1, wifi: 1, camera: 1 };
  var SERVICE = { pir: 1, temp: 1, co2: 1, pm: 1, leak: 1, door: 1, vape: 1, finger: 1, turnstile: 1, parking: 1 };
  function controllable(d) { return !!(POWER[d.kind] || SERVICE[d.kind]); }
  function offLabel(d) { return POWER[d.kind] ? 'вимкнено вручну' : 'виведено з роботи (обслуговування)'; }

  function st() {
    var s = SK.store.state;
    if (!s.manualOff) s.manualOff = {};
    if (!s.cmdLog) s.cmdLog = [];
    if (!s.doorPulse) s.doorPulse = {};
    return s;
  }
  function who() { return SEC.ROLES[SK.store.state.role].name; }
  function isOff(d) { return !!st().manualOff[d.id]; }

  /* Перевірка доставки: шлях до пристрою має бути цілим */
  function reach(d) {
    var iss = SK.faults ? SK.faults.deviceIssue(d) : null;
    if (iss && (iss.cause === 'cab' || iss.cause === 'ctrl')) return 'не доставлено: ' + iss.value;
    if (iss && iss.cause === 'link') return 'не доставлено: немає зв’язку серверної зі шафою ' + d.cabinet;
    if (SK.power && SK.power.state(SK.store.clock.now()).serverDown) return 'не доставлено: сервер вимкнено (резервне живлення)';
    return null;
  }
  function route(d) {
    var l = (d.conn || []).filter(function (x) { return x.inst; })[0];
    return 'А-001 → сервер → ' + d.topic.replace(/\/[^/]+$/, '') + '/set → ' + (d.cabinet || '—') + (l ? ' → ' + l.inst.short + ' ' + l.port : '');
  }
  function log(rec) {
    var s = st(); rec.id = U.uid('CMD'); rec.ts = SK.store.clock.now().getTime(); rec.by = who();
    s.cmdLog.unshift(rec); if (s.cmdLog.length > 200) s.cmdLog.length = 200;
    SEC.addEvent(rec.ok ? 'command' : 'command_fail', rec.room || null, rec.text + (rec.ok ? '' : ' — ' + rec.result) + ' · ' + rec.by, rec.ok);
    SK.store.save();
    return rec;
  }

  /* ---------- Команди ---------- */
  function setOff(d, off) {
    if (!SEC.can('scenario')) return { ok: false, result: 'немає прав' };
    var err = reach(d), text = (off ? (POWER[d.kind] ? 'Вимкнути вручну: ' : 'Вивести з роботи: ') : (POWER[d.kind] ? 'Увімкнути: ' : 'Повернути в роботу: ')) + d.name + ' (' + (d.room || d.label || d.id) + ')';
    if (!err) { if (off) st().manualOff[d.id] = { ts: SK.store.clock.now().getTime(), by: who() }; else delete st().manualOff[d.id]; }
    return log({ ok: !err, result: err || 'виконано, стан підтверджено', text: text, room: d.room, target: d.id, route: route(d) });
  }
  function toggle(d) { return setOff(d, !isOff(d)); }

  var DOOR_ACT = { pulse: 'Відчинити на 5 с', open: 'Тримати відчиненими', locked: 'Заблокувати', auto: 'Режим «за відбитком»' };
  function door(doorId, act, reason) {
    var dr = SEC.door(doorId); if (!dr) return null;
    var rdr = REG.roomDevices(dr.room).filter(function (x) { return x.kind === 'finger'; })[0];
    var text = DOOR_ACT[act] + ': ' + dr.name, err = null;
    if (!SEC.can('doors') && (act !== 'pulse' || dr.closed)) err = 'немає прав (лише адміністратор)';
    else if (dr.closed && act !== 'locked' && act !== 'auto' && !reason) err = 'для закритої зони потрібна причина';
    else if (rdr) err = reach(rdr);
    if (!err) {
      if (act === 'pulse') { st().doorPulse[doorId] = SK.store.clock.now().getTime() + 5000; SEC.setDoor(doorId, 'auto'); }
      else { delete st().doorPulse[doorId]; SEC.setDoor(doorId, act); }
      SK.store.state.accessLog.unshift({ ts: SK.store.clock.now().getTime(), door: doorId, user: 'оператор', ok: true, reason: DOOR_ACT[act] + ' (дистанційно' + (reason ? ', причина: ' + reason : '') + ')' });
    }
    return log({ ok: !err, result: err || 'виконано', text: text + (reason ? ' · причина: ' + reason : ''), room: dr.room, target: doorId, route: rdr ? route(rdr) : 'сервер доступу' });
  }
  function doorPulseOpen(doorId) { var u = st().doorPulse[doorId]; return !!u && SK.store.clock.now().getTime() < u; }

  /* Групові команди: усе в приміщенні / світло на поверсі */
  function roomPower(roomId, off) {
    var devs = REG.roomDevices({ id: roomId }).filter(function (d) { return POWER[d.kind] && d.kind !== 'panel' && d.kind !== 'camera'; });
    var res = devs.map(function (d) { return setOff(d, off); });
    var bad = res.filter(function (r) { return !r.ok; }).length;
    return { total: res.length, failed: bad };
  }
  function floorLights(block, floor, off) {
    var devs = REG.devices.filter(function (d) { return d.kind === 'light' && d.block === block && d.floor === floor && d.room; });
    var res = devs.map(function (d) { return setOff(d, off); });
    return { total: res.length, failed: res.filter(function (r) { return !r.ok; }).length };
  }
  function clearAll() {
    var n = Object.keys(st().manualOff).length; st().manualOff = {};
    log({ ok: true, result: 'виконано', text: 'Скасовано всі ручні вимкнення (' + n + ')', route: 'сервер' });
  }

  /* Вплив на симуляцію приміщення: що з обладнання вимкнено вручну */
  function roomOff(roomId) {
    var m = st().manualOff, out = null;
    REG.roomDevices({ id: roomId }).forEach(function (d) { if (m[d.id]) { out = out || {}; out[d.kind] = true; } });
    return out;
  }

  return { POWER: POWER, SERVICE: SERVICE, DOOR_ACT: DOOR_ACT, controllable: controllable, offLabel: offLabel, isOff: isOff, reach: reach, route: route,
    setOff: setOff, toggle: toggle, door: door, doorPulseOpen: doorPulseOpen, roomPower: roomPower, floorLights: floorLights, clearAll: clearAll, roomOff: roomOff,
    log: function () { return st().cmdLog; }, offList: function () { return st().manualOff; } };
})();
