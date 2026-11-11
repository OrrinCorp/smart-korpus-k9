/* Адаптер даних: точка інтеграції з обладнанням i3 Engineering.
 *
 * Контролери серії Atom підтримують MQTT і Modbus RS-485 (за даними виробника).
 * Цільова схема: Atom → MQTT-брокер (напр. Mosquitto на сервері університету)
 * → сервер «Розумного корпусу» → WebSocket → цей вебінтерфейс.
 *
 * Зараз активний режим 'sim' — значення обчислює SK.sensors (симуляція).
 * Режим 'mqtt' — заготовка: для неї потрібно підключити бібліотеку mqtt.js
 * (браузерна збірка, MQTT over WebSocket) і погодити з i3 Engineering формат
 * топіків/повідомлень. Схема топіків нижче — НАША пропозиція, не формат виробника.
 *
 *   chnu/k9/{блок}/{поверх}/{кімната}/{датчик}      → телеметрія (JSON)
 *   chnu/k9/{блок}/{поверх}/{кімната}/mode/set       ← команда сценарію
 *   chnu/k9/events                                   → події безпеки
 *
 * Приклад повідомлення телеметрії:
 *   {"ts": 1730886000, "value": 742, "unit": "ppm", "device": "CO2-А-305"}
 */
SK.i3 = (function () {
  var mode = 'sim';
  var live = {};          // roomId → {co2, temp, ...} з реальних датчиків
  var client = null;

  function connect(url, opts) {
    if (!window.mqtt) {
      console.warn('[i3] mqtt.js не підключено — залишаюся в режимі симуляції');
      return false;
    }
    client = window.mqtt.connect(url, opts || {});
    client.on('connect', function () { client.subscribe('chnu/k9/#'); mode = 'mqtt'; SK.store.emit('i3', { connected: true }); });
    client.on('message', function (topic, payload) {
      var p = topic.split('/');            // chnu k9 block floor room sensor
      if (p.length < 6) return;
      try {
        var msg = JSON.parse(payload.toString());
        (live[p[4]] = live[p[4]] || {})[p[5]] = msg.value;
      } catch (e) { }
    });
    client.on('close', function () { mode = 'sim'; SK.store.emit('i3', { connected: false }); });
    return true;
  }

  /* Єдина точка читання показників для інтерфейсу */
  function read(roomId, date) {
    var v = SK.sensors.read(roomId, date);
    if (mode === 'mqtt' && live[roomId]) {
      var l = live[roomId];
      if (l.co2 != null) v.co2 = l.co2;
      if (l.temp != null) v.temp = l.temp;
      if (l.pir != null) v.presence = !!l.pir;
      v.simulated = false;
    }
    return v;
  }

  /* Команда сценарію: у симуляції змінює стан, у MQTT — публікує команду */
  function setMode(roomId, m) {
    SK.sensors.setMode(roomId, m);
    if (mode === 'mqtt' && client) {
      var r = SK.building.room(roomId);
      client.publish('chnu/k9/' + r.block + '/' + r.floor + '/' + roomId + '/mode/set', JSON.stringify({ mode: m }));
    }
  }

  return { connect: connect, read: read, setMode: setMode, get mode() { return mode; } };
})();
