/* Резервне живлення корпусу (концепт + симуляція).
 *
 *   Ввід мережі 0,4 кВ ─┐
 *                      АВР (контроль фаз) ── ГРЩ А-003 ──┬─ категорія I  → центральний онлайн-ДБЖ (модульний N+1)
 *   ДГУ 60 кВА ────────┘                                │                 → живлення шаф ЩА (у кожній — свій DIN-ДБЖ 24 В)
 *                                                       ├─ категорія II → від ДГУ (коридори 30 %, Wi-Fi, ІТП)
 *                                                       └─ категорія III → відключається при роботі від резерву
 *
 * Три рівні резерву: (1) ДГУ через АВР — години; (2) центральний ДБЖ — 40 хв для сервера,
 * мережі й диспетчерської; (3) ДБЖ кожної шафи — ~6 год для контролерів, датчиків, зчитувачів і замків.
 * Тому навіть без мережі й ДГУ корпус лишається керованим і безпечним, а сервер вимикається коректно.
 * Потужності ОРІЄНТОВНІ — розрахунок робить проєктувальник електропостачання.
 * Аварійне освітлення та пожежна сигналізація мають власні сертифіковані джерела.
 */
SK.power = (function () {
  var U = SK.util;

  var DESIGN = {
    gen:   { name: 'ДГУ 60 кВА в шумозахисному кожусі', fuelHours: 8, startSec: 30, where: 'Майданчик ДГУ біля парковки P2',
             feeds: 'Запас палива ≈ 8 год при навантаженні 50 %; щотижневий тестовий пуск 15 хв; договір на дозаправку' },
    ats:   { name: 'АВР з контролем фаз і затримкою повернення', where: 'Електрощитова А-003',
             feeds: 'Перемикає ГРЩ на ДГУ через ~30 с після зникнення мережі; повертає на мережу після 5 хв стабільної напруги' },
    upsC:  { name: 'Центральний онлайн-ДБЖ 20 кВА, модульний N+1', autonomyMin: 40, where: 'Серверна А-002',
             feeds: 'Сервер «Розумного корпусу», MQTT-брокер, сервер доступу, ядро мережі, диспетчерська А-001. Зовнішній байпас для обслуговування' },
    upsCab:{ name: 'DIN-ДБЖ 24 В + АКБ 2×17 А·год у кожній шафі', autonomyMin: 360, where: 'Кожна шафа ЩА',
             feeds: 'Контролери Atom, датчики, біометричні зчитувачі, електрозамки, PoE-комутатор поверху' },
    mon:   { name: 'Моніторинг живлення', where: 'Atom Cobalt (Modbus) + Atom Argon (сухі контакти)',
             feeds: 'Стан АВР, ДГУ, рівень палива, заряд і несправності всіх ДБЖ, напруга на вводах шаф' },
    solar: { name: 'Розвиток: СЕС на даху + накопичувач', where: 'Дах блоку А (концепт)', feeds: 'Зменшує залежність від мережі в денні години' }
  };

  var CATS = {
    I:   { name: 'I — критичні', src: 'ДБЖ + ДГУ', kw: 9, items: 'Сервер і ядро мережі, шафи автоматики (контролери, датчики, зчитувачі, замки), охоронна сигналізація, відеоспостереження, диспетчерська' },
    II:  { name: 'II — важливі', src: 'ДГУ', kw: 18, items: 'Освітлення коридорів і сходів (30 %), Wi-Fi, інфотабло, ІТП і насоси опалення, вентиляція серверної' },
    III: { name: 'III — відключувані', src: 'вимикаються', kw: null, items: 'Освітлення аудиторій понад 30 %, ПК, проєктори, кондиціонування, розетки, буфет' }
  };

  /* Несправності обладнання, які можна імітувати */
  var FAULTS = {
    gen:    'ДГУ не запускається',
    ats:    'АВР не перемикає',
    upsC:   'Батареї центрального ДБЖ несправні',
    fuel:   'Низький рівень палива (20 %)'
  };

  function st() {
    var s = SK.store.state.power;
    if (!s.faults) s.faults = {};
    return s;
  }

  function outageAt(date) {
    var t = date.getTime(), list = st().outages || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var o = list[i];
      if (t >= o.from && (o.to == null || t < o.to)) return o;
    }
    return null;
  }
  function isOutage(date) { return !!outageAt(date); }
  function testAt(date) { var x = st().test; return x && date.getTime() >= x.from && date.getTime() < x.to ? x : null; }

  /* Повний стан системи живлення */
  function state(date) {
    var f = st().faults, o = outageAt(date), test = testAt(date);
    var startMin = DESIGN.gen.startSec / 60;
    if (!o) {
      return { grid: true, phase: test ? 'test' : 'grid', source: 'Мережа', minutes: 0,
        gen: test ? 'тестовий пуск' : f.gen ? 'НЕСПРАВНА' : 'резерв (готова)', genOn: !!test,
        fuel: f.fuel ? 20 : 100, upsC: f.upsC ? 0 : 100, upsCFault: !!f.upsC, atsFault: !!f.ats, genFault: !!f.gen,
        upsCLeftMin: f.upsC ? 0 : DESIGN.upsC.autonomyMin, shed: false, serverDown: false };
    }
    var t = (date.getTime() - o.from) / 60000;
    var noStart = o.genFail || f.gen || f.ats;
    var fuel0 = f.fuel ? 20 : 100;
    var runMin = Math.max(0, t - startMin);
    var fuel = noStart ? fuel0 : Math.max(0, fuel0 - runMin / (DESIGN.gen.fuelHours * 60) * 100);
    var genOn = !noStart && t >= startMin && fuel > 0;
    var aut = f.upsC ? 0.2 : DESIGN.upsC.autonomyMin;          // несправні АКБ — лише кілька секунд
    /* скільки хвилин центральний ДБЖ віддавав енергію: під час пуску ДГУ, без ДГУ, або після того як скінчилося паливо */
    var dischargeMin = noStart ? t : t < startMin ? t : genOn ? startMin : startMin + (runMin - fuel0 / 100 * DESIGN.gen.fuelHours * 60);
    var upsC = Math.max(0, 100 - Math.max(0, dischargeMin) / aut * 100);
    if (genOn) upsC = f.upsC ? 0 : Math.min(100, upsC + runMin * 1.2);
    return {
      grid: false, phase: genOn ? 'gen' : 'ups', minutes: t, genOn: genOn, genFail: !!noStart, upsCFault: !!f.upsC, atsFault: !!f.ats, genFault: !!f.gen,
      source: genOn ? 'ДГУ через АВР' : 'ДБЖ (батареї)',
      gen: f.ats ? 'готова, але АВР не перемкнув' : noStart ? 'НЕ ЗАПУСТИЛАСЯ' : genOn ? 'працює' : fuel <= 0 ? 'зупинена: немає палива' : 'запуск…',
      fuel: Math.round(fuel), upsC: Math.round(upsC), upsCLeftMin: Math.round(upsC / 100 * aut),
      serverDown: !genOn && upsC <= 10, shed: true, outageFrom: o.from
    };
  }

  /* ---------- Живлення окремої шафи ЩА ---------- */
  function cabState(cabId, date) {
    var sim = (SK.store.state.sim && SK.store.state.sim.cab[cabId]) || {}, ps = state(date);
    var feedOk = !sim.feedLost && (ps.grid || ps.genOn);
    var res = { feedOk: feedOk, upsFault: !!sim.upsFault, uplink: !sim.linkLost, sim: sim };
    if (feedOk) { res.batt = sim.upsFault ? 0 : 100; res.online = true; res.src = ps.grid ? 'мережа' : 'ДГУ'; res.leftMin = sim.upsFault ? 0 : DESIGN.upsCab.autonomyMin; return res; }
    var from = sim.feedLost ? sim.feedLostAt : ps.outageFrom;
    var mins = Math.max(0, (date.getTime() - (from || date.getTime())) / 60000);
    res.batt = sim.upsFault ? 0 : Math.max(0, Math.round(100 - mins / DESIGN.upsCab.autonomyMin * 100));
    res.leftMin = sim.upsFault ? 0 : Math.max(0, Math.round(DESIGN.upsCab.autonomyMin - mins));
    res.online = res.batt > 0; res.src = 'батарея ДБЖ шафи';
    return res;
  }

  /* ---------- Керування симуляцією ---------- */
  function startOutage(genFail) {
    var s = st(); if (outageAt(SK.store.clock.now())) return;
    s.outages.push({ from: SK.store.clock.now().getTime(), to: null, genFail: !!genFail });
    s.flags = {};
    SK.store.save();
    SK.security.addEvent('power', null, 'Зникла напруга мережі. Критичні навантаження — від ДБЖ; запуск ДГУ через АВР (ТЕСТ).', false, 'grid');
  }
  function restore() {
    var o = outageAt(SK.store.clock.now()); if (!o) return;
    o.to = SK.store.clock.now().getTime();
    SK.store.save();
    var n = SK.security.resolve('grid', 'мережу відновлено');
    SK.security.addEvent('power_ok', null, 'Закрито подій відключення: ' + n + '. Напругу мережі відновлено. АВР повернув живлення від мережі, ДГУ — у резерв (ТЕСТ).');
  }
  function toggleFault(k) {
    var f = st().faults; f[k] = !f[k]; SK.store.save();
    if (f[k]) SK.security.addEvent('power', 'А-003', 'Імітація несправності: ' + FAULTS[k] + '.', false, 'pow:' + k);
    else { SK.security.resolve('pow:' + k, 'усунуто'); SK.security.addEvent('power_ok', 'А-003', 'Усунуто: ' + FAULTS[k] + '.', true, 'pow:' + k); }
  }
  function genTest() {
    var n = SK.store.clock.now().getTime();
    if (st().faults.gen || st().faults.ats) { SK.security.addEvent('power_crit', null, 'Тестовий пуск ДГУ невдалий: ' + (st().faults.gen ? FAULTS.gen : FAULTS.ats) + '. Потрібен виклик сервісної служби.'); return false; }
    st().test = { from: n, to: n + 15 * 60000 }; st().lastTest = n; SK.store.save();
    SK.security.addEvent('power_ok', null, 'Тестовий пуск ДГУ: старт за ' + DESIGN.gen.startSec + ' с, напруга й частота в нормі. Тривалість тесту 15 хв.', true);
    return true;
  }

  /* Перевірка порогів — події в журнал (раз на тік панелі) */
  function check(date) {
    var s = state(date), f = st().flags || (st().flags = {});
    function once(k, type, text) { if (!f[k]) { f[k] = 1; SK.security.addEvent(type, null, text, false, 'grid'); } }
    if (s.grid) { f.gen = f.genfail = f.low = f.down = f.fuel = f.fuel0 = 0; return s; }
    if (s.phase === 'gen') once('gen', 'power', 'ДГУ запущено, АВР перемкнув навантаження. Аудиторії — у сценарії «Резервне живлення», категорія III вимкнена.');
    if (s.genFail && s.minutes > 1) once('genfail', 'power_crit', (s.atsFault ? 'АВР не перемкнув на ДГУ' : 'ДГУ не запустилася') + '! Сервер — від центрального ДБЖ (~' + s.upsCLeftMin + ' хв), шафи — від власних ДБЖ (~6 год).');
    if (s.upsC <= 20 && !s.genOn) once('low', 'power_crit', 'Центральний ДБЖ: заряд ' + s.upsC + ' %. Підготовка до коректного вимкнення сервера.');
    if (s.serverDown) once('down', 'power_crit', 'Сервер коректно вимкнено. Контролери Atom, зчитувачі й замки працюють автономно від ДБЖ шаф.');
    if (s.fuel <= 25 && s.genOn) once('fuel', 'power', 'Паливо ДГУ: ' + s.fuel + ' % — потрібна дозаправка.');
    if (s.fuel <= 0) once('fuel0', 'power_crit', 'ДГУ зупинилася: закінчилося паливо. Живлення — лише від ДБЖ.');
    return s;
  }

  return { DESIGN: DESIGN, CATS: CATS, FAULTS: FAULTS, state: state, cabState: cabState, isOutage: isOutage,
    startOutage: startOutage, restore: restore, toggleFault: toggleFault, genTest: genTest, check: check,
    lastTest: function () { return st().lastTest || null; } };
})();
