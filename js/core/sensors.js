/* Модуль «Комфорт і розумна аудиторія» — СИМУЛЯТОР датчиків.
 *
 * Значення обчислюються як детермінована функція від часу, розкладу,
 * активного сценарію (SK.scenarios) і стану живлення (SK.power).
 * Тому всі вкладки бачать однакові показники, а історію енергії можна
 * відновити за будь-який момент. У реальній системі значення надходять від
 * контролерів i3 Engineering Atom через MQTT (js/core/i3-adapter.js).
 */
SK.sensors = (function () {
  var U = SK.util, S = SK.schedule, B = SK.building;

  function minuteOfDay(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  function daylight(m, room) {
    var t = (m - 450) / (990 - 450);
    if (t <= 0 || t >= 1) return 0;
    var k = room.x0 < -30 || room.y1 > 30 ? 1 : 0.7;
    return Math.round(Math.sin(Math.PI * t) * 260 * k);
  }

  /* opts.automation=false — розрахунок «без автоматики» (для порівняння енергії);
     opts.ignoreManual — без ручних сценаріїв (для історії). */
  function read(roomId, date, opts) {
    opts = opts || {};
    var r = B.room(roomId), st = SK.store.state;
    var automation = opts.automation != null ? opts.automation : st.settings.automation;
    var m = minuteOfDay(date), day = U.dow(date);
    var segs = S.occupancy(roomId, date);
    var cur = null, last = null, next = null, firstStart = null, lastEnd = null;
    segs.forEach(function (s) {
      if (m >= s.s && m < s.e) cur = s;
      if (s.e <= m && (!last || s.e > last.e)) last = s;
      if (s.s > m && (!next || s.s < next.s)) next = s;
      if (firstStart === null || s.s < firstStart) firstStart = s.s;
      if (lastEnd === null || s.e > lastEnd) lastEnd = s.e;
    });
    var seed = U.hash01(roomId + '|' + Math.floor(date.getTime() / 300000));
    var people = cur ? Math.max(0, Math.round(cur.people * (0.75 + 0.25 * U.hash01(roomId + cur.s + U.dateKey(date))))) : 0;
    var outage = SK.power ? SK.power.isOutage(date) : false;
    var smk = r.type === 'smoking' ? smoking(roomId, date, m, day) : null;
    if (smk) people = smk.people;

    /* Активний сценарій */
    var res;
    if (automation || outage) res = SK.scenarios.resolve(r, date, { m: m, day: day, people: people, cur: cur, next: next, last: last, ignoreManual: opts.ignoreManual });
    else {   /* без автоматики: світло й техніка працюють від першої пари до 18:00 */
      var on = firstStart !== null && m >= firstStart - 10 && m < Math.max(lastEnd || 0, 18 * 60);
      res = { sc: SK.scenarios.get(on || people ? 'lesson' : 'empty'), rule: null };
    }
    var sc = res.sc, p = sc.p;

    /* CO₂, ppm — залежить від людей і режиму вентиляції */
    var vf = { auto: 30, boost: 20, min: 44, off: 56 }[p.vent] || 30;
    if (!automation && !outage) vf = 42;
    var co2 = 430 + seed * 30;
    if (cur) co2 += people * vf * (1 - Math.exp(-(m - cur.s) / 25));
    else if (last) co2 += last.people * vf * (1 - Math.exp(-(last.e - last.s) / 25)) * Math.exp(-(m - last.e) / (p.vent === 'off' ? 40 : 14));
    var co2Boost = p.vent === 'auto' && co2 > 1000;
    if (co2Boost) co2 = 1000 + (co2 - 1000) * 0.6;
    if (smk) co2 = 460 + people * 25 + seed * 40;
    if (r.type === 'wc' || r.type === 'stairs' || r.type === 'hall') co2 = 450 + seed * 80;

    /* Температура */
    var temp = p.hvac + (seed - 0.5) * 0.6;
    if (cur) temp += people * 0.05 * (1 - Math.exp(-(m - cur.s) / 30));
    if (outage) temp -= Math.min(2.5, (SK.power.state(date).minutes || 0) / 120);
    if (r.type === 'server') temp = 23.5 + seed;
    var hum = 38 + people * 0.25 + seed * 4;

    /* Освітлення: сценарій для аудиторій; службові — свої правила */
    var lightLevel = r.bookable || r.type === 'library' ? p.light / 100 : 0;
    var work = m > 7 * 60 && m < 20 * 60;
    if (r.type === 'hall' || r.type === 'stairs') lightLevel = outage ? 0.3 : work ? 0.6 : 0.15;
    if (r.type === 'wc') lightLevel = people || (m > 8 * 60 && m < 18 * 60 && U.hash01(roomId + Math.floor(m / 7)) > 0.6) ? 1 : 0;
    if (r.type === 'office' || r.type === 'service' || r.type === 'security') lightLevel = m > 8 * 60 && m < 17 * 60 && U.hash01(roomId + U.dateKey(date)) > 0.25 ? (outage ? 0.3 : 1) : 0;
    if (r.type === 'admin') lightLevel = work ? 0.8 : 0.4;            // диспетчерська працює цілодобово
    if (r.type === 'server' || r.type === 'tech' || r.type === 'electric') lightLevel = 0;
    if (smk) lightLevel = people ? 1 : (work ? 0.2 : 0);
    var mo = SK.control ? SK.control.roomOff(roomId) : null;   // обладнання, вимкнене диспетчером вручну
    if (mo && mo.light) lightLevel = 0;
    var lux = daylight(m, r) + Math.round(lightLevel * 420);

    /* Потужність, Вт */
    var pLight = r.area * 9 * lightLevel;
    var pcs = r.pcs || 0, pPC = 0;
    if (pcs) {
      if (p.pcs === 'on') pPC = people > 0 ? Math.min(pcs, people) * 110 + (pcs - Math.min(pcs, people)) * 35 : pcs * 35;
      else if (p.pcs === 'standby') pPC = pcs * 4;
    }
    var pProj = p.projector && r.bookable && r.type !== 'cowork' && (people > 0 || sc.id === 'presentation') ? 280 : 0;
    var pBoard = p.board && r.bookable && (people > 0 || sc.id === 'presentation') ? 150 : 0;
    var pHvac = (r.type === 'lecture' || r.type === 'computer') && p.vent !== 'off' ? (180 + people * 6) * (p.vent === 'min' ? 0.4 : co2Boost || p.vent === 'boost' ? 1.6 : 1) : 0;
    var pFixed = r.type === 'server' ? 3200 : r.type === 'admin' ? 700 : r.type === 'tech' ? (outage ? 0 : 400) :
      r.type === 'electric' ? 150 : r.type === 'service' && lightLevel && !outage ? 900 : r.type === 'office' && lightLevel ? (outage ? 60 : 350) : 0;
    if (smk) pFixed = smk.exhaust ? 450 : 40;            // витяжний вентилятор
    if (mo) { if (mo.sockets) { pPC = 0; pProj = 0; } if (mo.board) pBoard = 0; if (mo.hvac) pHvac = 0; if (mo.exhaust && smk) { smk.exhaust = false; pFixed = 40; } }
    var power = pLight + pPC + pProj + pBoard + pHvac + pFixed;

    var faults = st.faults || {};
    return {
      room: roomId, people: people, presence: people > 0,
      mode: res.manual ? sc.id : 'auto', effMode: sc.id, scName: sc.name, rule: res.rule ? res.rule.name : '—', hold: !!res.hold,
      manual: res.manual || null, params: p, co2Boost: co2Boost,
      smoking: smk, pm25: smk ? smk.pm25 : null,
      co2: Math.round(co2), temp: U.round(temp, 1), hum: Math.round(hum), lux: lux,
      lightLevel: lightLevel, lightOn: lightLevel > 0, power: Math.round(power),
      parts: { light: pLight, pc: pPC, projector: pProj, board: pBoard, hvac: pHvac, fixed: pFixed },
      fault: !!faults['T-' + roomId] || !!faults['CO2-' + roomId], simulated: true
    };
  }


  /* Кімната для куріння: люди переважно на перервах; витяжка працює під час
     присутності та 10 хв після; PM2.5 зростає з кількістю людей, витяжка його знижує. */
  function smoking(roomId, date, m, day) {
    var P = S.PAIRS, brk = null;
    for (var i = 0; i < P.length - 1; i++) if (m >= P[i].e && m < P[i + 1].s) brk = { s: P[i].e, e: P[i + 1].s };
    var wd = day <= 5 && m > 8 * 60 && m < 18 * 60;
    var h = U.hash01(roomId + '|' + Math.floor(date.getTime() / 120000));
    var people = !wd ? 0 : brk ? 1 + Math.floor(h * 5) : (h > 0.82 ? 1 : 0);
    var afterBreak = false;
    for (var k = 0; k < P.length - 1; k++) if (m >= P[k + 1].s && m < P[k + 1].s + 10) afterBreak = true;
    var exhaust = people > 0 || (wd && afterBreak);
    var pm25 = Math.round(8 + people * 38 * (exhaust ? 0.35 : 1) + (afterBreak && !people ? 12 : 0));
    var doorOpen = SK.store.state.faults['SMKDOOR-' + roomId] || false;
    return { people: people, exhaust: exhaust, pm25: pm25, doorOpen: doorOpen, visitsToday: wd ? Math.round(Math.max(0, m - 480) / 600 * 60 * (0.7 + U.hash01(roomId) * 0.6)) : 0 };
  }

  function co2Level(v) { return v < 800 ? 'good' : v < 1200 ? 'warn' : 'bad'; }
  function co2Text(v) { return v < 800 ? 'Свіже повітря' : v < 1200 ? 'Варто провітрити' : 'Задушливо — потрібне провітрювання'; }

  /* Сумісність: старий інтерфейс ручного режиму */
  function setMode(roomId, mode) { SK.scenarios.apply([roomId], mode, null); }

  return { read: read, co2Level: co2Level, co2Text: co2Text, setMode: setMode };
})();
