/* Модуль «Енергоефективність» (ТЗ п. 3.5).
 * Сумарна потужність = сума кімнат (див. sensors.js) + базове навантаження
 * (коридори, вентиляція, насоси). Порівняння «з автоматикою / без автоматики»
 * показує потенціал заощадження. Усі значення — ДЕМОНСТРАЦІЙНІ.
 * У реальній системі споживання знімається вбудованими датчиками струму
 * контролерів Atom (моніторинг вводів) або лічильником з Modbus. */
SK.energy = (function () {
  var B = SK.building, U = SK.util, SEN = SK.sensors;
  var STEP = 15; // хв

  function baseLoad(date) {
    var m = date.getHours() * 60 + date.getMinutes();
    var work = m > 7 * 60 + 30 && m < 19 * 60;
    if (SK.power && SK.power.isOutage(date)) return { A: 1600, B: 800, C: 60 };   // категорія III вимкнена
    return { A: work ? 5200 : 1800, B: work ? 2600 : 900, C: work ? 300 : 80 };
  }

  /* Потужність по блоках на момент date, Вт */
  function power(date, opts) {
    var bl = baseLoad(date), res = { A: bl.A, B: bl.B, C: bl.C, total: 0 };
    B.rooms.forEach(function (r) { res[r.block] += SEN.read(r.id, date, opts).power; });
    res.total = res.A + res.B + res.C;
    return res;
  }

  var cache = {};
  /* Профіль доби: масив {t(хв), kw, kwBase} з кроком 15 хв до моменту upTo */
  function dayProfile(date, upTo) {
    var key = U.dateKey(date) + '|' + JSON.stringify(SK.store.state.settings.automation) + '|' + SK.store.state.bookings.length +
      '|' + SK.store.state.customLessons.length + '|' + SK.store.state.removedLessons.length + '|' + JSON.stringify(SK.store.state.power.outages) + '|' + JSON.stringify(SK.store.state.scenarioCfg || 0).length;
    var full = cache[key];
    if (!full) {
      full = [];
      var d = new Date(date); d.setHours(0, 0, 0, 0);
      for (var t = 0; t < 24 * 60; t += STEP) {
        var at = new Date(d.getTime() + t * 60000);
        var a = power(at, { ignoreManual: true }).total;
        var b = power(at, { ignoreManual: true, automation: false }).total;
        full.push({ t: t, kw: a / 1000, kwBase: b / 1000 });
      }
      if (Object.keys(cache).length > 30) cache = {};
      cache[key] = full;
    }
    if (upTo == null) return full;
    return full.filter(function (p) { return p.t <= upTo; });
  }

  function sum(profile, field) {
    return profile.reduce(function (a, p) { return a + p[field] * STEP / 60; }, 0);
  }

  /* Підсумки за сьогодні до поточного моменту */
  function today(now) {
    var m = now.getHours() * 60 + now.getMinutes();
    var prof = dayProfile(now, m);
    var kwh = sum(prof, 'kw'), kwhBase = sum(prof, 'kwBase');
    return { kwh: kwh, kwhBase: kwhBase, saved: Math.max(0, kwhBase - kwh), profile: prof };
  }

  /* 7 днів до дати включно (повні доби, сьогодні — до поточного часу) */
  function week(now) {
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      var prof = i === 0 ? dayProfile(d, now.getHours() * 60 + now.getMinutes()) : dayProfile(d);
      out.push({ date: d, kwh: sum(prof, 'kw'), kwhBase: sum(prof, 'kwBase'), partial: i === 0 });
    }
    return out;
  }

  function topRooms(date, n) {
    return B.rooms.map(function (r) { return { room: r, w: SEN.read(r.id, date).power }; })
      .sort(function (a, b) { return b.w - a.w; }).slice(0, n || 8);
  }

  /* Перевірка порогу: повертає true, якщо потужність вища за поріг */
  var lastAlert = 0;
  function checkThreshold(now, p) {
    var th = SK.store.state.settings.energyThresholdKw;
    if (p.total / 1000 > th && now.getTime() - lastAlert > 3600000) {
      lastAlert = now.getTime();
      return true;
    }
    return false;
  }

  return { power: power, dayProfile: dayProfile, today: today, week: week, topRooms: topRooms, checkThreshold: checkThreshold, STEP: STEP };
})();
