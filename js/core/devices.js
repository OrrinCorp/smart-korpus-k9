/* Стан розумних пристроїв і території (СИМУЛЯЦІЯ).
 * Для кожного пристрою з реєстру SK.devicesI3 повертає статус і поточне значення.
 * Тут же — симуляція парковок і місця для куріння. */
SK.devices = (function () {
  var U = SK.util, REG = SK.devicesI3, T = SK.territory, S = SK.schedule;

  var STATUS = {
    ok:     { name: 'Норма', lvl: 'good' },
    active: { name: 'Активний', lvl: 'good' },
    idle:   { name: 'Очікування', lvl: 'good' },
    off:    { name: 'Вимкнено вручну', lvl: 'off' },
    fault:  { name: 'Несправність', lvl: 'warn' },
    alarm:  { name: 'Тривога', lvl: 'bad' }
  };

  function minutes(d) { return d.getHours() * 60 + d.getMinutes(); }
  function isBreak(m) {
    for (var i = 0; i < S.PAIRS.length - 1; i++) if (m >= S.PAIRS[i].e && m < S.PAIRS[i + 1].s) return true;
    return false;
  }

  /* ---------- Парковки ---------- */
  function parkingRate(d) {
    var m = minutes(d), wd = U.dow(d) <= 5;
    if (!wd) return 0.12;
    if (m < 7 * 60 + 30) return 0.05;
    if (m < 8 * 60 + 20) return 0.05 + (m - 450) / 50 * 0.6;
    if (m < 15 * 60) return 0.88;
    if (m < 18 * 60) return 0.88 - (m - 900) / 180 * 0.6;
    return 0.15;
  }
  function spotTaken(spot, d) {
    var rate = parkingRate(d) * (spot.mgn ? 0.5 : 1);
    return U.hash01(spot.id + '|' + U.dateKey(d)) < rate;
  }
  function parking(d, lot) {
    var list = T.spots.filter(function (s) { return !lot || s.lot === lot; });
    var taken = list.filter(function (s) { return spotTaken(s, d); }).length;
    var mgnFree = list.filter(function (s) { return s.mgn && !spotTaken(s, d); }).length;
    return { total: list.length, taken: taken, free: list.length - taken, mgnFree: mgnFree };
  }

  /* ---------- Кімнати для куріння (на кожному поверсі) ---------- */
  function smokingRooms(d) {
    return SK.building.rooms.filter(function (r) { return r.type === 'smoking'; }).map(function (r) {
      var v = SK.i3.read(r.id, d); return { room: r, v: v, s: v.smoking };
    });
  }

  /* ---------- Стан окремого пристрою ---------- */
  function state(dev, d) {
    var res = { status: 'ok', value: '' };
    var issue = SK.faults ? SK.faults.deviceIssue(dev, d) : null;   // живлення шафи → контролер → пристрій → зв'язок
    if (issue && issue.cause !== 'link') return { status: 'fault', value: issue.value, cause: issue.cause };
    if (SK.control && SK.control.isOff(dev)) return { status: 'off', value: SK.control.offLabel(dev) };   // ручне вимкнення диспетчером
    var ev = dev.room ? SK.security.roomAlarm(dev.room) : null;
    var link = { door_forced: ['door', 'finger'], access_repeat: ['finger'], alarm: ['pir'], leak: ['leak'], vape: ['vape'] };
    if (ev && link[ev.type] && link[ev.type].indexOf(dev.kind) >= 0) return { status: 'alarm', value: SK.security.TYPES[ev.type].name };

    var v = dev.room ? SK.i3.read(dev.room, d) : null, m = minutes(d);
    switch (dev.kind) {
      case 'pir': res.status = v.people ? 'active' : 'idle'; res.value = v.people ? 'рух · ' + v.people + ' ос.' : 'нікого'; break;
      case 'temp': res.value = v.temp + ' °C'; break;
      case 'co2': res.value = v.co2 + ' ppm · ' + v.hum + ' %'; if (v.co2 >= 1200) res.status = 'active'; break;
      case 'light': res.status = v.lightOn ? 'active' : 'idle'; res.value = v.lightOn ? Math.round(v.lightLevel * 100) + ' %' : 'вимкнено'; break;
      case 'hvac': res.status = v.params.vent !== 'off' ? 'active' : 'idle'; res.value = { auto: v.co2Boost ? 'посилено (CO₂)' : 'за CO₂', boost: 'посилена', min: 'мінімальна', off: 'вимкнена' }[v.params.vent] + ' · ' + v.params.hvac + ' °C'; break;
      case 'board':
        var s = S.status(dev.room, d);
        res.status = v.params.board && (s.status === 'busy' || v.effMode === 'presentation') ? 'active' : 'idle';
        res.value = res.status === 'active' ? (s.lesson ? 'заняття ' + s.lesson.group + ' · запис конспекту' : 'презентація') : 'сон'; break;
      case 'panel': res.value = 'сценарій: ' + v.scName; break;
      case 'blinds': res.value = SK.scenarios.PARAMS.blinds.opts[v.params.blinds]; res.status = v.params.blinds === 'open' ? 'idle' : 'active'; break;
      case 'sockets':
        var on = v.params.pcs !== 'off' || v.params.projector;
        res.status = on ? 'active' : 'idle'; res.value = on ? 'увімкнено · ' + Math.round((v.parts.pc + v.parts.projector + v.parts.board) / 10) * 10 + ' Вт' : 'знеструмлено сценарієм'; break;
      case 'meter':
        var kw = SK.building.rooms.filter(function (r) { return r.block === dev.block && r.floor === dev.floor; })
          .reduce(function (a, r) { return a + SK.i3.read(r.id, d).power; }, 0) / 1000;
        res.status = 'active'; res.value = 'поверх ' + U.fmt(kw, 1) + ' кВт'; break;
      case 'server': case 'accsrv': case 'core': case 'console':
        var ps0 = SK.power.state(d);
        if (ps0.serverDown && dev.kind !== 'console') { res.status = 'fault'; res.value = 'вимкнено (ДБЖ розряджено)'; }
        else { res.status = 'active'; res.value = ps0.grid ? 'онлайн' : 'онлайн · від ДБЖ'; }
        break;
      case 'upsc': var p1 = SK.power.state(d); res.status = p1.grid ? 'ok' : 'active'; res.value = (p1.grid ? 'мережа · ' : 'батарея · ') + Math.round(p1.upsC) + ' %'; if (!p1.grid && p1.upsC < 25) res.status = 'fault'; break;
      case 'upscab': var c2 = SK.power.cabState(dev.label.replace('ДБЖ ', ''), d);
        res.status = c2.upsFault ? 'fault' : c2.feedOk ? 'ok' : 'active';
        res.value = c2.upsFault ? 'АКБ несправні' : (c2.feedOk ? 'заряджено · ' : 'батарея · ') + c2.batt + ' %' + (c2.feedOk ? '' : ' · ~' + c2.leftMin + ' хв'); break;
      case 'ats': var p3 = SK.power.state(d); res.status = p3.grid ? 'ok' : 'active'; res.value = p3.grid ? 'введення 1: мережа' : p3.phase === 'gen' ? 'введення 2: ДГУ' : 'очікування ДГУ'; break;
      case 'gen': var p4 = SK.power.state(d); res.status = p4.grid ? 'idle' : p4.genFail ? 'alarm' : 'active'; res.value = p4.gen + (p4.grid ? '' : ' · паливо ' + p4.fuel + ' %'); break;
      case 'signage': res.status = m > 7 * 60 && m < 20 * 60 ? 'active' : 'idle'; res.value = res.status === 'active' ? (dev.label || 'розклад') : 'вимкнено вночі'; break;
      case 'finger':
        var ds = SK.security.doorState('D-' + dev.room);
        res.value = (ds === 'open' ? 'відчинено' : 'зачинено') + (SK.security.doorMode('D-' + dev.room) === 'locked' ? ' (блок.)' : '') + ' · ост. відбиток ' + U.minToHHMM(Math.max(450, m - Math.floor(U.hash01(dev.id + Math.floor(m / 30)) * 50)));
        break;
      case 'turnstile':
        var people = m > 7 * 60 + 30 && m < 18 * 60 ? Math.round(12 + U.hash01(dev.id + Math.floor(m / 5)) * (isBreak(m) ? 60 : 15)) : 0;
        res.status = people ? 'active' : 'idle'; res.value = people + ' проходів / 5 хв'; break;
      case 'door': if (v && v.smoking) { res.value = v.smoking.doorOpen ? 'відчинено надто довго' : 'зачинено (доводчик)'; if (v.smoking.doorOpen) res.status = 'fault'; break; }
        res.value = SK.security.doorState('D-' + dev.room) === 'open' ? 'відчинено' : 'зачинено'; break;
      case 'leak': res.value = 'сухо'; break;
      case 'vape': res.value = 'чисто'; break;
      case 'camera': res.value = 'онлайн'; break;
      case 'wifi': res.value = Math.round(5 + U.hash01(dev.id + Math.floor(m / 10)) * (m > 480 && m < 1080 ? 60 : 4)) + ' клієнтів'; break;
      case 'cabinet':
        var cab = REG.cabinet(dev.label) || {}, cs = SK.power.cabState(cab.id, d);
        res.status = !cs.uplink ? 'fault' : cs.feedOk ? 'ok' : 'active';
        res.value = (cab.controllers ? cab.controllers.length + ' контролерів · ' : '') + (cs.feedOk ? 'живлення: ' + cs.src : 'ДБЖ ' + cs.batt + ' %') + (cs.uplink ? '' : ' · немає зв’язку'); break;
      case 'parking': var pk = parking(d, dev.zone); res.value = 'вільно ' + pk.free + ' з ' + pk.total; res.status = pk.free ? 'ok' : 'active'; break;
      case 'bench': res.value = m > 16 * 60 + 40 || m < 7 * 60 + 30 ? 'підсвітка увімк.' : 'зарядка USB доступна'; break;
      case 'exhaust': res.status = v.smoking.exhaust ? 'active' : 'idle'; res.value = v.smoking.exhaust ? 'працює (розрідження)' : 'черговий режим'; break;
      case 'pm': res.value = 'PM2.5 ' + v.pm25 + ' мкг/м³'; if (v.pm25 > 150) res.status = 'active'; break;
      case 'pole': res.status = m > 16 * 60 + 40 || m < 7 * 60 + 30 ? 'active' : 'idle'; res.value = res.status === 'active' ? 'увімк. за PIR' : 'день'; break;
    }
    if (issue && issue.cause === 'link') { res.status = 'fault'; res.value = (res.value ? res.value + ' · ' : '') + 'дані не надходять'; }
    return res;
  }

  function summary(d) {
    var out = { total: REG.devices.length, fault: 0, alarm: 0, byCat: {} };
    REG.devices.forEach(function (dev) {
      var s = state(dev, d).status;
      if (s === 'fault') out.fault++;
      if (s === 'alarm') out.alarm++;
      out.byCat[dev.cat] = (out.byCat[dev.cat] || 0) + 1;
    });
    return out;
  }

  return { STATUS: STATUS, state: state, summary: summary, parking: parking, spotTaken: spotTaken, smokingRooms: smokingRooms, isBreak: isBreak };
})();
