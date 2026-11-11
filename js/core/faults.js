/* Модель несправностей та імітацій (одне джерело правди).
 *
 * Причини, від найсильнішої до найслабшої:
 *   1. шафа ЩА без живлення і її ДБЖ розряджений / несправний → усі пристрої шафи offline;
 *   2. відмова контролера (модуля в шафі)                       → пристрої на його портах offline;
 *   3. несправність самого пристрою (датчик, зчитувач…)          → лише цей пристрій;
 *   4. обрив зв'язку шафи з серверною                           → пристрої працюють локально,
 *      але дані не надходять у систему (сценарії на контролерах виконуються далі).
 * Тривоги (двері, протікання, вейп, рух) — це події безпеки; вони теж прив'язані до портів.
 *
 * Стан, карта, схема комутації, журнал подій читають усе звідси, тому не суперечать одне одному.
 * Імітації запускаються зі схеми комутації (вкладка «Комутація») та вкладки «Живлення».
 */
SK.faults = (function () {
  var REG = SK.devicesI3, SEC = SK.security;

  function sim() {
    var s = SK.store.state;
    if (!s.sim) s.sim = {};
    if (!s.sim.cab) s.sim.cab = {};
    if (!s.sim.ctrl) s.sim.ctrl = {};
    if (!s.sim.flags) s.sim.flags = {};
    return s.sim;
  }
  function now() { return SK.store.clock.now(); }

  /* ---------- Діагностика ---------- */
  function deviceIssue(dev, date) {
    date = date || now();
    var st = SK.store.state, faults = st.faults || {}, S = sim();
    if (dev.cabinet) {
      var c = SK.power.cabState(dev.cabinet, date);
      if (!c.online) return { status: 'fault', cause: 'cab', value: 'немає живлення (шафа ' + dev.cabinet + ')' };
    }
    var conn = dev.conn || [];
    for (var i = 0; i < conn.length; i++) {
      var l = conn[i];
      if (l.inst && S.ctrl[l.inst.id]) return { status: 'fault', cause: 'ctrl', value: 'контролер ' + l.inst.short + ' не відповідає', inst: l.inst.id };
    }
    if (faults[dev.id] || (dev.kind === 'temp' && faults['T-' + dev.room]) || (dev.kind === 'co2' && faults['CO2-' + dev.room]))
      return { status: 'fault', cause: 'dev', value: 'пристрій не відповідає' };
    if (dev.cabinet && SK.power.cabState(dev.cabinet, date).uplink === false)
      return { status: 'fault', cause: 'link', value: 'працює локально, дані не надходять (немає зв’язку шафи)' };
    return null;
  }
  function ctrlState(inst, date) {
    var c = SK.power.cabState(inst.cabinet, date || now());
    if (!c.online) return { status: 'offline', text: 'немає живлення шафи' };
    if (sim().ctrl[inst.id]) return { status: 'offline', text: 'відмова контролера' };
    var bad = inst.ports.filter(function (l) { var x = deviceIssue(l.device, date); return x && x.cause === 'dev'; }).length;
    return bad ? { status: 'warn', text: bad + ' несправних пристроїв' } : { status: 'ok', text: 'норма' };
  }
  /* Стан порту для схеми шафи: ok | fault | alarm | off */
  function portState(link, date) {
    var x = deviceIssue(link.device, date);
    if (x) return x.cause === 'dev' ? 'fault' : x.cause === 'link' ? 'stale' : 'off';
    if (SK.control && SK.control.isOff(link.device)) return 'manual';
    var d = link.device, ev = d.room ? SEC.roomAlarm(d.room) : null;
    var map = { door_forced: ['door', 'finger'], access_repeat: ['finger'], alarm: ['pir'], leak: ['leak'], vape: ['vape'], smoke_door: ['door'] };
    if (ev && map[ev.type] && map[ev.type].indexOf(d.kind) >= 0) return 'alarm';
    return 'ok';
  }
  function summary(date) {
    var S = sim(), out = { cabOff: 0, cabBatt: 0, cabLink: 0, ctrl: Object.keys(S.ctrl).length, dev: Object.keys(SK.store.state.faults || {}).length };
    REG.cabinets.forEach(function (c) {
      var x = SK.power.cabState(c.id, date || now());
      if (!x.online) out.cabOff++; else if (!x.feedOk) out.cabBatt++;
      if (!x.uplink) out.cabLink++;
    });
    out.any = out.cabOff + out.cabBatt + out.cabLink + out.ctrl + out.dev;
    return out;
  }

  /* ---------- Імітації ---------- */
  /* Усунення: відкриті події з тим самим ключем закриваються (лишаються в журналі), плюс запис «усунуто» */
  function fixed(ref, room, text) { var n = SEC.resolve(ref, text); SEC.addEvent('sim_ok', room, text + (n ? ' Закрито подій: ' + n + '.' : ''), true, ref); }
  var TRIGGERS = {     // тип пристрою → подія безпеки, яку він може згенерувати
    door: { type: 'door_forced', label: 'Двері відчинено без доступу' },
    finger: { type: 'access_denied', label: 'Невідомий відбиток' },
    leak: { type: 'leak', label: 'Спрацювання: протікання' },
    vape: { type: 'vape', label: 'Спрацювання: дим/вейп' },
    pir: { type: 'alarm', label: 'Рух в охоронному режимі' }
  };
  function trigger(dev) {
    var t = TRIGGERS[dev.kind]; if (!t) return null;
    if (dev.kind === 'finger') { var door = SEC.door('D-' + dev.room); if (door) return SEC.attempt(null, door.id); }
    if (dev.kind === 'door') {
      var r = SK.building.room(dev.room);
      if (r && r.type === 'smoking') { SK.store.state.faults['SMKDOOR-' + r.id] = true; return SEC.addEvent('smoke_door', r.id, 'Імітація зі схеми комутації: ' + dev.id + ' (' + linkText(dev) + ').'); }
      SEC.setDoor('D-' + dev.room, 'open');
    }
    return SEC.addEvent(t.type, dev.room, 'Імітація зі схеми комутації: ' + dev.id + ' (' + linkText(dev) + ').');
  }
  function linkText(dev) { return (dev.conn || []).filter(function (l) { return l.inst; }).map(function (l) { return l.inst.id + ' ' + l.port; }).join(', '); }
  function toggleDevice(dev) {
    var f = SK.store.state.faults;
    if (f[dev.id]) { delete f[dev.id]; fixed('dev:' + dev.id, dev.room, 'Відновлено: ' + dev.name + ' (' + dev.id + ').'); }
    else { f[dev.id] = true; SEC.addEvent('sensor_fault', dev.room, dev.name + ' (' + dev.id + ') не відповідає · порт ' + linkText(dev) + ' (імітація).', false, 'dev:' + dev.id); }
    SK.store.save();
  }
  function toggleCtrl(inst) {
    var S = sim();
    if (S.ctrl[inst.id]) { delete S.ctrl[inst.id]; fixed('ctrl:' + inst.id, null, 'Контролер ' + inst.id + ' знову на зв’язку.'); }
    else { S.ctrl[inst.id] = SK.store.clock.now().getTime(); SEC.addEvent('ctrl_fault', null, 'Контролер ' + inst.id + ' (' + inst.model + ') не відповідає — ' + inst.ports.length + ' пристроїв без керування (імітація).', false, 'ctrl:' + inst.id); }
    SK.store.save();
  }
  function cab(cabId) { var S = sim(); return S.cab[cabId] || (S.cab[cabId] = {}); }
  function toggleCabFeed(cabId) {
    var c = cab(cabId);
    if (c.feedLost) { c.feedLost = false; delete sim().flags['batt-' + cabId]; delete sim().flags['off-' + cabId]; fixed('feed:' + cabId, null, 'Живлення шафи ' + cabId + ' відновлено.'); }
    else { c.feedLost = true; c.feedLostAt = SK.store.clock.now().getTime(); SEC.addEvent('cab_power', null, 'Шафа ' + cabId + ': немає напруги на вводі — працює від власного ДБЖ (імітація).', false, 'feed:' + cabId); }
    SK.store.save();
  }
  function toggleCabUps(cabId) {
    var c = cab(cabId); c.upsFault = !c.upsFault;
    if (c.upsFault) SEC.addEvent('ups_fault', null, 'Шафа ' + cabId + ': несправність АКБ ДБЖ — резерву немає (імітація).', false, 'ups:' + cabId); else fixed('ups:' + cabId, null, 'АКБ ДБЖ шафи ' + cabId + ' замінено.');
    SK.store.save();
  }
  function toggleCabLink(cabId) {
    var c = cab(cabId); c.linkLost = !c.linkLost;
    if (c.linkLost) SEC.addEvent('cab_link', null, 'Шафа ' + cabId + ': немає зв’язку із серверною. Контролери виконують сценарії локально (імітація).', false, 'link:' + cabId); else fixed('link:' + cabId, null, 'Зв’язок шафи ' + cabId + ' відновлено.');
    SK.store.save();
  }
  function resetCab(cabId) {
    var S = sim(); delete S.cab[cabId];
    ['feed:', 'ups:', 'link:'].forEach(function (k) { SEC.resolve(k + cabId, 'скинуто'); });
    SK.wiring.instances(cabId).forEach(function (i) { delete S.ctrl[i.id]; SEC.resolve('ctrl:' + i.id, 'скинуто'); });
    REG.devices.forEach(function (d) { if (d.cabinet === cabId) { delete SK.store.state.faults[d.id]; SEC.resolve('dev:' + d.id, 'скинуто'); } });
    SEC.addEvent('sim_ok', null, 'Усі імітації в шафі ' + cabId + ' скинуто.', true);
    SK.store.save();
  }
  function resetAll() {
    SK.store.state.events.forEach(function (e) { if (e.ref && /^(dev|ctrl|feed|ups|link):/.test(e.ref)) SEC.resolve(e.ref, 'скинуто'); });
    SK.store.state.sim = { cab: {}, ctrl: {}, flags: {} }; SK.store.state.faults = {};
    SEC.addEvent('sim_ok', null, 'Усі імітації несправностей скинуто.', true); SK.store.save();
  }
  /* Порогові події по шафах (раз на тік) */
  function check(date) {
    var F = sim().flags;
    REG.cabinets.forEach(function (c) {
      var x = SK.power.cabState(c.id, date);
      if (!x.feedOk && x.online && x.batt <= 20 && !F['batt-' + c.id]) { F['batt-' + c.id] = 1; SEC.addEvent('cab_power', null, 'Шафа ' + c.id + ': ДБЖ ' + x.batt + ' % (~' + x.leftMin + ' хв).', false, 'feed:' + c.id); }
      if (!x.online && !F['off-' + c.id]) { F['off-' + c.id] = 1; SEC.addEvent('cab_off', null, 'Шафа ' + c.id + ' знеструмлена: контролери, зчитувачі й датчики поверху недоступні. Замки — у безпечному стані за проєктом.', false, 'feed:' + c.id); }
      if (x.online) delete F['off-' + c.id];
    });
  }

  /* Демонстрація: по одній несправності кожного виду в шафі cabId */
  function demo(cabId) {
    cabId = cabId || 'ЩА-А2'; resetAll();
    var devs = REG.devices.filter(function (d) { return d.cabinet === cabId; });
    var co2 = devs.filter(function (d) { return d.kind === 'co2'; })[0], leak = devs.filter(function (d) { return d.kind === 'leak'; })[0];
    var hy = SK.wiring.instances(cabId).filter(function (i) { return i.model === 'Atom Hydrogen'; })[0];
    if (co2) toggleDevice(co2);
    if (hy) toggleCtrl(hy);
    if (leak) trigger(leak);
    toggleCabFeed(cabId);
    return co2;
  }

  return { deviceIssue: deviceIssue, demo: demo, ctrlState: ctrlState, portState: portState, summary: summary, TRIGGERS: TRIGGERS,
    trigger: trigger, toggleDevice: toggleDevice, toggleCtrl: toggleCtrl, toggleCabFeed: toggleCabFeed, toggleCabUps: toggleCabUps,
    toggleCabLink: toggleCabLink, resetCab: resetCab, resetAll: resetAll, check: check, cab: function (id) { return sim().cab[id] || {}; },
    ctrlDown: function (id) { return !!sim().ctrl[id]; } };
})();
