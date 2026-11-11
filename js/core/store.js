/* Сховище стану + шина подій + симульований годинник.
 *
 * Стан зберігається в localStorage, тому панель керування (index.html) і
 * студентський додаток (student.html), відкриті в сусідніх вкладках одного
 * браузера, бачать спільні бронювання, події та оголошення (подія 'storage').
 * У реальному розгортанні цей модуль замінюється викликами REST/WebSocket API
 * сервера (див. docs/architecture.md).
 */
SK.store = (function () {
  var KEY = 'sk9_state_v2';          // v2: 5 поверхів (0–4), сценарії, доступ за відбитками, живлення
  var listeners = {};

  function defaults() {
    return {
      version: 2,
      role: 'guest',                 // guest | responsible | admin
      clock: { baseReal: Date.now(), baseSim: defaultSimStart(), speed: 1 },
      bookings: [],                  // {id, room, date, pair, who, purpose, createdAt}
      customLessons: [],             // заняття, додані адміністратором
      removedLessons: [],            // id занять, знятих адміністратором
      events: [],                    // журнал подій безпеки та енергетики
      announcements: [
        { id: 'an-1', ts: Date.now(), text: 'Вітаємо в демо-версії «Розумного корпусу»! Усі дані тут вигадані.', from: 'Адміністрація' }
      ],
      overrides: {},                 // roomId → {sc, until} — ручний сценарій
      scenarioCfg: null,             // null = типова конфігурація сценаріїв і правил
      scLog: [],                     // журнал змін сценаріїв
      power: { outages: [], flags: {} }, // відключення електроенергії (симуляція)
      access: null,                  // користувачі біометричного доступу (знеособлені)
      accessLog: [],                 // журнал проходів
      uniEvents: null,               // розклад подій (null = демо-події)
      doors: {},                     // doorId → auto | locked | open (режим дверей, симуляція)
      faults: {},                    // deviceId → true (несправні датчики)
      settings: {
        automation: true,            // автоматичне вимкнення світла/обладнання
        autoOffMin: 10,              // хв без присутності до вимкнення
        energyThresholdKw: 130,       // поріг сповіщення про високе споживання
        model: { scale: 1, rotY: 0, x: 0, y: 0, z: 0, showRooms: true }
      }
    };
  }

  /* За замовчуванням — найближчий робочий день, 09:55 (2-га пара), щоб демо одразу було «живим». */
  function defaultSimStart() {
    var d = new Date();
    var day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    if (day === 0) d.setDate(d.getDate() + 1);
    var mins = d.getHours() * 60 + d.getMinutes();
    if (mins < 8 * 60 + 20 || mins > 17 * 60 + 30 || day === 0 || day === 6) d.setHours(9, 55, 0, 0);
    return d.getTime();
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw), d = defaults();
        for (var k in d) if (!(k in s)) s[k] = d[k];
        for (var k2 in d.settings) if (!(k2 in s.settings)) s.settings[k2] = d.settings[k2];
        return s;
      }
    } catch (e) { /* приватний режим або зіпсовані дані — працюємо з типовими */ }
    return defaults();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    emit('change');
  }

  function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); }
  function emit(evt, data) { (listeners[evt] || []).forEach(function (cb) { cb(data); }); }

  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var prevRole = state.role;
    state = load();
    state.role = prevRole;           // роль — локальна для вкладки
    emit('change', { remote: true });
  });

  /* ---- Симульований годинник ---- */
  var clock = {
    now: function () {
      var c = state.clock;
      return new Date(c.baseSim + (Date.now() - c.baseReal) * c.speed);
    },
    set: function (date) {
      state.clock = { baseReal: Date.now(), baseSim: date.getTime(), speed: state.clock.speed };
      save(); emit('tick');
    },
    setSpeed: function (speed) {
      state.clock = { baseReal: Date.now(), baseSim: clock.now().getTime(), speed: speed };
      save();
    },
    speed: function () { return state.clock.speed; }
  };

  function reset() {
    var role = state.role;
    state = defaults(); state.role = role;
    save();
  }

  return {
    get state() { return state; },
    save: save, on: on, emit: emit, clock: clock, reset: reset
  };
})();
