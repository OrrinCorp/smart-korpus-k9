/* Журнали для вивантаження (CSV): історія показів датчиків, відкриття дверей і проходи,
 * тривоги й несправності.
 *
 * Звідки дані в реальній системі:
 *  - покази датчиків — MQTT-повідомлення контролерів Atom (1-Wire, Modbus RS-485, DI), які сервер
 *    «Розумного корпусу» записує в часову базу (наприклад, TimescaleDB / InfluxDB);
 *  - двері — геркони (цифрові входи Atom Argon) + журнал біометричного контролера доступу;
 *  - тривоги — журнал подій сервера (SK.security).
 * У прототипі історію відтворює та сама модель, що й «живі» покази (sensors.js, розклад, сценарії),
 * тому журнал узгоджений з картою й графіками. Реальні дії в цьому браузері (спроби доступу,
 * імітації, тестові тривоги) додаються до журналу як є.
 *
 * CSV: UTF-8 з BOM, роздільник «;», десяткова кома — відкривається в Excel з українськими налаштуваннями. */
SK.logs = (function () {
  var U = SK.util, B = SK.building, SEN = SK.sensors, REG = SK.devicesI3, SEC = SK.security, S = SK.schedule;
  var MAX_ROWS = 200000;

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fDate(d) { return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function fTime(d, sec) { return p2(d.getHours()) + ':' + p2(d.getMinutes()) + (sec ? ':' + p2(d.getSeconds()) : ''); }
  function num(v, dec) { return v == null || v === '' ? '' : (dec ? Number(v).toFixed(dec) : String(Math.round(v))).replace('.', ','); }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function roomName(id) { var r = id && B.room(id); return r ? r.name : ''; }
  function blockName(b) { return b === 'T' ? 'Територія' : (B.blockById(b) || { name: b }).name; }

  /* Період: {from: Date, to: Date} — to не включно; preset: today | yesterday | week | custom */
  function period(preset, now, from, to) {
    var t0 = dayStart(now);
    if (preset === 'yesterday') return { from: new Date(t0.getTime() - 86400000), to: t0 };
    if (preset === 'week') return { from: new Date(t0.getTime() - 6 * 86400000), to: now };
    if (preset === 'custom' && from && to) {
      var a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'); b = new Date(b.getTime() + 86400000);
      if (b > now) b = now;
      return a < b ? { from: a, to: b } : { from: t0, to: now };
    }
    return { from: t0, to: now };
  }

  /* Фільтр місця: {scope:'all'|'block'|'floor'|'room'|'device', block, floor, room, device} */
  function inScope(o, f) {
    if (!f || !f.scope || f.scope === 'all') return true;
    if (f.scope === 'block') return o.block === f.block;
    if (f.scope === 'floor') return o.block === f.block && o.floor === +f.floor;
    if (f.scope === 'room') return o.room === f.room;
    if (f.scope === 'device') return o.id === f.device || (!o.kind && o.room === f.room);
    return true;
  }

  /* =================== 1. ПОКАЗИ ДАТЧИКІВ =================== */
  var SENSOR_TYPES = {
    temp: { name: 'Температура (1-Wire)', params: [['Температура', '°C', 'temp', 1]] },
    co2:  { name: 'CO₂ / температура / вологість', params: [['CO₂', 'ppm', 'co2', 0], ['Температура', '°C', 'temp', 1], ['Вологість', '%', 'hum', 0]] },
    pir:  { name: 'Присутність (PIR)', params: [['Присутність', 'так/ні', 'presence', 0], ['Людей (оцінка)', 'осіб', 'people', 0]] },
    pm:   { name: 'PM2.5 / дим', params: [['PM2.5', 'мкг/м³', 'pm25', 0]] },
    leak: { name: 'Протікання', params: [['Протікання', 'так/ні', 'leak', 0]] },
    door: { name: 'Двері (геркон)', params: [['Двері', 'відчинено/зачинено', 'door', 0]] }
  };
  function sensorDevices(f, kinds) {
    return REG.devices.filter(function (d) { return SENSOR_TYPES[d.kind] && kinds.indexOf(d.kind) >= 0 && inScope(d, f); });
  }
  function sensorCount(per, step, f, kinds) {
    var n = Math.ceil((per.to - per.from) / (step * 60000)), c = 0;
    sensorDevices(f, kinds).forEach(function (d) { c += SENSOR_TYPES[d.kind].params.length; });
    return n * c;
  }
  var SENSOR_HEAD = ['Дата', 'Час', 'Пристрій (ID)', 'Тип датчика', 'Приміщення', 'Назва приміщення', 'Блок', 'Поверх', 'Показник', 'Значення', 'Одиниця', 'Стан'];
  /* Генерує рядки; newestFirst — для попереднього перегляду */
  function sensorRows(per, step, f, kinds, limit, newestFirst) {
    var devs = sensorDevices(f, kinds), rows = [], t0 = per.from.getTime(), t1 = per.to.getTime(), ms = step * 60000;
    var faults = SK.store.state.faults || {}, today = U.dateKey(SK.store.clock.now());
    var times = []; for (var t = t0; t < t1; t += ms) times.push(t);
    if (newestFirst) times.reverse();
    var byRoom = {}; devs.forEach(function (d) { (byRoom[d.room || '—'] = byRoom[d.room || '—'] || []).push(d); });
    for (var i = 0; i < times.length && rows.length < limit; i++) {
      var at = new Date(times[i]), dS = fDate(at), tS = fTime(at);
      Object.keys(byRoom).forEach(function (rid) {
        if (rows.length >= limit) return;
        var v = rid !== '—' ? SEN.read(rid, at) : null;
        byRoom[rid].forEach(function (d) {
          var bad = U.dateKey(at) === today && (faults[d.id] || faults['T-' + d.room] && d.kind === 'temp' || faults['CO2-' + d.room] && d.kind === 'co2');
          SENSOR_TYPES[d.kind].params.forEach(function (p, k) {
            var val = '';
            if (!bad && v) {
              if (p[2] === 'presence') val = v.people > 0 ? 'так' : 'ні';
              else if (p[2] === 'pm25') val = num(v.pm25 != null ? v.pm25 : 6 + U.hash01(d.id + Math.floor(times[i] / 600000)) * 5, 0);
              else if (p[2] === 'leak') val = leakAt(d.room, times[i]) ? 'так' : 'ні';
              else if (p[2] === 'door') val = doorOpenAt(d.room, times[i]) ? 'відчинено' : 'зачинено';
              else val = num(v[p[2]] + (k && d.kind === 'co2' && p[2] === 'temp' ? 0.1 : 0), p[3]);
            }
            rows.push([dS, tS, d.id, SENSOR_TYPES[d.kind].name, d.room || '', roomName(d.room), blockName(d.block), d.block === 'T' ? '' : d.floor, p[0], val, p[1], bad ? 'несправність' : 'норма']);
          });
        });
      });
    }
    return rows;
  }
  /* Протікання: лише з реальних подій журналу (тестові / імітовані) */
  function leakAt(room, t) {
    return SK.store.state.events.some(function (e) { return e.type === 'leak' && e.room === room && e.ts <= t && (e.status !== 'closed' ? true : (e.at || e.ts) >= t); });
  }

  /* =================== 2. ДВЕРІ Й ПРОХОДИ =================== */
  /* Усі двері з герконом і/або біометричним зчитувачем */
  var doors = (function () {
    var m = {};
    REG.devices.forEach(function (d) {
      if ((d.kind === 'door' || d.kind === 'finger') && d.room) {
        var r = B.room(d.room), o = m[d.room] = m[d.room] || { id: 'D-' + d.room, room: d.room, block: r.block, floor: r.floor, type: r.type, reed: false, reader: false };
        if (d.kind === 'door') o.reed = true; else o.reader = true;
      }
    });
    var list = Object.keys(m).map(function (k) { var o = m[k], sd = SEC.door(o.id); o.zone = sd ? sd.zone : null; o.name = o.room + ' · ' + B.room(o.room).name; return o; });
    REG.devices.filter(function (d) { return d.kind === 'turnstile'; }).forEach(function (d) {
      list.push({ id: d.id, room: null, block: d.block, floor: d.floor, type: 'entry', reed: false, reader: true, zone: 'entry', name: d.label, turnstile: true });
    });
    return list;
  })();
  var doorById = {}; doors.forEach(function (o) { doorById[o.id] = o; });

  /* Події одних дверей за добу (детерміновано): [{t (мс), kind, user, ok, reason, dur (с)}] */
  var dayCache = {};
  function doorDay(door, date) {
    var key = door.id + '|' + U.dateKey(date);
    if (dayCache[key]) return dayCache[key];
    var d0 = dayStart(date).getTime(), out = [], wd = U.dow(date) <= 5;
    var users = SEC.users();
    function pickUser(salt) { return users[Math.floor(U.hash01(key + salt) * users.length)]; }
    function open(min, salt, viaReader) {
      var t = d0 + Math.round(min * 60000 + U.hash01(key + salt + 's') * 59000);
      var dur = Math.round(4 + U.hash01(key + salt + 'd') * 14);
      if (U.hash01(key + salt + 'h') > 0.985) dur = Math.round(70 + U.hash01(key + salt + 'x') * 240);   // зрідка — тримали відчиненими
      var ev = { t: t, dur: door.reed ? dur : null, via: viaReader && door.reader ? 'відбиток' : door.reader ? 'вихід (кнопка)' : 'вільний прохід' };
      if (viaReader && door.reader) {
        /* Підходить той, хто має право на ці двері в цей час (як у житті); зрідка — помилки */
        var dt = new Date(t), sd = SEC.door(door.id) || { id: door.id, zone: door.zone || 'study', room: door.room }, u = null, r = null;
        for (var tr = 0; tr < 12; tr++) { var cu = pickUser(salt + '#' + tr), cr = SEC.check(cu, sd, dt); if (cr.ok) { u = cu; r = cr; break; } if (!u) { u = cu; r = cr; } }
        var fx = U.hash01(key + salt + 'f');
        if (fx > 0.985) { u = null; r = { ok: false, reason: 'Відбиток не зареєстровано' }; }
        else if (r.ok && fx > 0.97) r = { ok: false, reason: 'Відбиток не розпізнано — повторіть' };
        ev.user = u ? u.id : 'невідомий'; ev.ok = r.ok; ev.reason = r.reason;
        if (!r.ok) ev.dur = null;
      }
      out.push(ev);
    }
    var segs = door.room ? S.occupancy(door.room, date) : [];
    if (door.turnstile) {
      if (wd) for (var m = 7 * 60 + 30; m < 19 * 60; m += 1) {
        var rush = (m % 95 < 12 ? 6 : 1) * (m < 9 * 60 ? 2.2 : 1);
        var nIn = Math.floor(U.hash01(key + m) * rush * 1.6);
        for (var q = 0; q < nIn; q++) open(m, 'T' + m + '-' + q, true);
      }
    } else if (door.type === 'admin' || door.type === 'security') {
      [7 * 60 + 55, 19 * 60 + 55].forEach(function (m, k) { open(m, 'shift' + k, true); open(m + 3, 'shiftx' + k, false); });
      for (var k2 = 0; k2 < 8; k2++) open(8 * 60 + U.hash01(key + 'a' + k2) * 11 * 60, 'a' + k2, U.hash01(key + 'r' + k2) > 0.4);
    } else if (door.zone === 'server' || door.zone === 'tech' || door.type === 'tech' || door.type === 'electric' || door.type === 'server') {
      var nT = wd ? 1 + Math.floor(U.hash01(key + 'n') * 4) : U.hash01(key + 'n') > 0.7 ? 1 : 0;
      for (var k3 = 0; k3 < nT; k3++) { var mt = 8 * 60 + U.hash01(key + 't' + k3) * 9 * 60; open(mt, 't' + k3, true); open(mt + 5 + U.hash01(key + 'tt' + k3) * 40, 'tx' + k3, false); }
    } else if (door.type === 'smoking') {
      if (wd) for (var b = 0; b < 7; b++) { var mb = 9 * 60 + 35 + b * 95; for (var v = 0; v < 3 + U.hash01(key + 'b' + b) * 5; v++) open(mb + v * 1.5, 'b' + b + '-' + v, false); }
    } else if (door.type === 'office') {
      if (wd) for (var k4 = 0; k4 < 6 + U.hash01(key + 'o') * 8; k4++) open(8 * 60 + U.hash01(key + 'o' + k4) * 9 * 60, 'o' + k4, k4 === 0 || U.hash01(key + 'or' + k4) > 0.6);
    } else {
      segs.forEach(function (sg, i) {
        var n1 = Math.min(10, 2 + Math.ceil((sg.people || 10) / 6));
        for (var j = 0; j < n1; j++) open(sg.s - 9 + j * 1.2, 'in' + i + '-' + j, j === 0);
        for (var j2 = 0; j2 < Math.ceil(n1 / 2); j2++) open(sg.e + j2 * 0.8, 'out' + i + '-' + j2, false);
      });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    if (Object.keys(dayCache).length > 4000) dayCache = {};
    return (dayCache[key] = out);
  }
  function doorOpenAt(room, t) {
    var door = doorById['D-' + room]; if (!door) return false;
    if (SK.store.state.faults['SMKDOOR-' + room] && U.dateKey(new Date(t)) === U.dateKey(SK.store.clock.now())) return true;
    return doorDay(door, new Date(t)).some(function (e) { return e.dur && t >= e.t && t < e.t + e.dur * 1000; });
  }

  var DOOR_HEAD = ['Дата', 'Час', 'Двері', 'Приміщення', 'Блок', 'Поверх', 'Зона доступу', 'Подія', 'Спосіб', 'Користувач', 'Результат', 'Причина', 'Відчинено, с', 'Примітка', 'Джерело'];
  /* maskUsers — для ролі без права бачити біометричні журнали (знеособлення) */
  function doorRows(per, f, limit, newestFirst, maskUsers) {
    var rows = [], now = SK.store.clock.now().getTime();
    var ds = doors.filter(function (o) { return inScope({ id: o.id, room: o.room, block: o.block, floor: o.floor }, f); });
    for (var day = dayStart(per.from).getTime(); day < per.to.getTime(); day += 86400000) {
      ds.forEach(function (o) {
        doorDay(o, new Date(day + 12 * 3600000)).forEach(function (e) {
          if (e.t < per.from.getTime() || e.t >= per.to.getTime() || e.t > now) return;
          var at = new Date(e.t), long = e.dur && e.dur > 60;
          var evName = e.user ? (e.ok ? (o.turnstile ? 'Прохід через турнікет' : 'Вхід за відбитком') : 'Відмова доступу') : o.reed ? 'Відчинено' : 'Прохід';
          rows.push({ t: e.t, r: [fDate(at), fTime(at, true), o.name, o.room || '', blockName(o.block), o.turnstile ? '' : o.floor, o.zone ? (SEC.ZONES[o.zone] || o.zone) : '—', evName, e.via,
            e.user ? (maskUsers && e.user !== 'невідомий' ? e.user.slice(0, 3) + '•••' : e.user) : '', e.user ? (e.ok ? 'дозволено' : 'відмова') : '', e.reason && !e.ok ? e.reason : '',
            e.dur != null ? e.dur : '', long ? 'тримали відчиненими понад 60 с' : '', 'симуляція за розкладом'] });
        });
      });
    }
    /* Реальні спроби в цьому браузері (вкладка «Доступ») */
    (SK.store.state.accessLog || []).forEach(function (a) {
      var o = doorById[a.door] || { name: a.door, room: '', block: '', floor: '', zone: null };
      if (a.ts < per.from.getTime() || a.ts >= per.to.getTime()) return;
      if (!inScope({ id: o.id, room: o.room, block: o.block, floor: o.floor }, f)) return;
      var at = new Date(a.ts);
      rows.push({ t: a.ts, r: [fDate(at), fTime(at, true), o.name, o.room || '', o.block ? blockName(o.block) : '', o.floor, o.zone ? SEC.ZONES[o.zone] : '', a.ok ? 'Вхід за відбитком' : 'Відмова доступу', 'відбиток',
        maskUsers && a.user !== 'невідомий' ? String(a.user).slice(0, 3) + '•••' : a.user, a.ok ? 'дозволено' : 'відмова', a.ok ? '' : a.reason, '', '', 'дія в системі'] });
    });
    rows.sort(function (a, b) { return newestFirst ? b.t - a.t : a.t - b.t; });
    return rows.slice(0, limit).map(function (x) { return x.r; });
  }
  function doorSummary(per, f) {
    var s = { opens: 0, granted: 0, denied: 0, long: 0, turnstile: 0 };
    doorRows(per, f, MAX_ROWS, false, true).forEach(function (r) {
      if (r[7] === 'Прохід через турнікет') s.turnstile++;
      else if (r[7] === 'Вхід за відбитком') s.granted++;
      else if (r[7] === 'Відмова доступу') s.denied++;
      if (r[7] === 'Відчинено' || r[7] === 'Вхід за відбитком') s.opens++;
      if (r[13]) s.long++;
    });
    return s;
  }

  /* =================== 3. ТРИВОГИ Й НЕСПРАВНОСТІ =================== */
  var ALARM_HEAD = ['Дата', 'Час', 'Подія', 'Важливість', 'Приміщення', 'Блок', 'Поверх', 'Опис', 'Статус', 'Хто обробив', 'Тривалість, хв', 'Джерело'];
  function alarmRows(per, f, limit, newestFirst, withDerived) {
    var rows = [], T = SEC.TYPES;
    function rm(id) { var r = id && B.room(id); return r ? { room: id, block: r.block, floor: r.floor } : { room: null, block: null, floor: null }; }
    SK.store.state.events.forEach(function (e) {
      if (e.ts < per.from.getTime() || e.ts >= per.to.getTime()) return;
      if (e.type === 'access_granted' || e.type === 'command') return;          // це не тривоги — вони в журналі дверей / команд
      var o = rm(e.room); if (!inScope(o, f)) return;
      var at = new Date(e.ts);
      rows.push({ t: e.ts, r: [fDate(at), fTime(at, true), T[e.type].name, SEC.SEV[e.sev], e.room || '', o.block ? blockName(o.block) : '', o.floor == null ? '' : o.floor,
        e.note, SEC.STATUS[e.status] + (e.resolved ? ' (' + e.resolved + ')' : ''), e.by || '', e.at ? Math.max(0, Math.round((e.at - e.ts) / 60000)) : '', 'журнал подій системи'] });
    });
    if (withDerived !== false) {
      /* Аналіз показів: CO₂ ≥ 1000 ppm у навчальних приміщеннях (крок 5 хв) */
      B.rooms.filter(function (r) { return r.bookable && inScope({ room: r.id, block: r.block, floor: r.floor }, f); }).forEach(function (r) {
        var open = null, mx = 0;
        for (var t = per.from.getTime(); t <= per.to.getTime(); t += 300000) {
          var v = t < per.to.getTime() ? SEN.read(r.id, new Date(t)).co2 : 0;
          if (v >= 1000) { if (!open) { open = t; mx = 0; } mx = Math.max(mx, v); }
          else if (open) {
            var at = new Date(open);
            rows.push({ t: open, r: [fDate(at), fTime(at), 'Високий рівень CO₂', SEC.SEV.info, r.id, blockName(r.block), r.floor,
              'CO₂ до ' + mx + ' ppm — потрібне провітрювання' + (SK.store.state.settings.automation ? ' (автоматика ввімкнула посилену вентиляцію)' : ''), 'Закрита (норму відновлено)', 'Система', Math.round((t - open) / 60000), 'аналіз показів датчиків'] });
            open = null;
          }
        }
      });
      /* Журнал дверей: тримали відчиненими > 60 с, відмови доступу */
      doorRows(per, f, MAX_ROWS, false, true).forEach(function (r) {
        if (!r[13] && r[10] !== 'відмова') return;
        rows.push({ t: +new Date(r[0].split('.').reverse().join('-') + 'T' + r[1]), r: [r[0], r[1], r[10] === 'відмова' ? 'Відмова доступу' : 'Двері тримали відчиненими', r[10] === 'відмова' ? SEC.SEV.warning : SEC.SEV.info,
          r[3], r[4], r[5], r[2] + (r[10] === 'відмова' ? ': ' + r[11] : ': ' + r[12] + ' с'), 'Закрита', 'Система', r[12] ? Math.round(r[12] / 60) : '', 'журнал дверей'] });
      });
    }
    rows.sort(function (a, b) { return newestFirst ? b.t - a.t : a.t - b.t; });
    return rows.slice(0, limit).map(function (x) { return x.r; });
  }

  /* =================== CSV =================== */
  function csv(head, rows) {
    function cell(c) { c = c == null ? '' : String(c); return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }
    return '﻿' + [head].concat(rows).map(function (r) { return r.map(cell).join(';'); }).join('\r\n');
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  return { MAX_ROWS: MAX_ROWS, SENSOR_TYPES: SENSOR_TYPES, period: period, doors: doors, fDate: fDate,
    SENSOR_HEAD: SENSOR_HEAD, sensorRows: sensorRows, sensorCount: sensorCount, sensorDevices: sensorDevices,
    DOOR_HEAD: DOOR_HEAD, doorRows: doorRows, doorSummary: doorSummary, doorOpenAt: doorOpenAt,
    ALARM_HEAD: ALARM_HEAD, alarmRows: alarmRows, csv: csv, download: download };
})();
