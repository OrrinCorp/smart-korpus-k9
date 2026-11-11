/* Режими розфарбування 3D-карти та легенди до них (спільні для обох застосунків). */
SK.colorModes = (function () {
  var U = SK.util, S = SK.schedule, I3 = SK.i3;
  var GRAY = 0xc7cdd1, DIM = 0xe1e5e8;
  var TEMP = [[17, 0x3b7dd8], [20, 0x5fb3a8], [22, 0x2e9e5b], [24, 0xd99a1e], [26, 0xd64545]];
  var CO2 = [[600, 0x2e9e5b], [900, 0x9fbf3a], [1200, 0xd99a1e], [1600, 0xd64545]];

  function special(room) {
    if (room.type === 'wc') return 0x8fb3c9;
    if (room.type === 'smoking') return 0x9c7a5b;
    if (room.type === 'tech') return 0xb7bfc5;
    if (room.type === 'wc' || room.type === 'tech') return 0xb7bfc5;
    if (room.type === 'hall') return 0xd8dde0;
    return null;
  }

  var MODES = {
    status: {
      name: 'Статус аудиторій',
      color: function (room, now) {
        var sp = special(room); if (sp != null) return sp;
        if (!room.bookable) return room.type === 'admin' ? 0x1f4e79 : room.type === 'server' ? 0x7b6fa8 : room.type === 'electric' ? 0x6b7a1e : GRAY;
        return S.STATUS[S.status(room.id, now).status].color;
      },
      legend: function () {
        return '<span class="k"><i style="background:var(--free)"></i>Вільна</span><span class="k"><i style="background:var(--busy)"></i>Зайнята</span>' +
          '<span class="k"><i style="background:var(--booked)"></i>Заброньована / подія</span><span class="k"><i style="background:#c7cdd1"></i>Службові</span>' +
          '<span class="k"><i style="background:#1f4e79"></i>Адмін. приміщення</span><span class="k"><i style="background:#7b6fa8"></i>Серверна</span>' +
          '<span class="k"><i style="background:#8fb3c9"></i>Санвузол</span><span class="k"><i style="background:#9c7a5b"></i>Кімната для куріння</span>';
      }
    },
    scenario: {
      name: 'Активний сценарій',
      color: function (room, now) {
        if (!room.bookable) return special(room) || DIM;
        return scColor(I3.read(room.id, now).effMode);
      },
      legend: function () {
        return SK.scenarios.list().map(function (s) { return '<span class="k"><i style="background:' + U.hex(scColor(s.id)) + '"></i>' + U.esc(s.name) + '</span>'; }).join('');
      }
    },
    temp: {
      name: 'Температура',
      color: function (room, now) { var sp = special(room); if (sp != null && room.type !== 'hall') return sp; return U.scale(TEMP, I3.read(room.id, now).temp); },
      legend: function () { return grad(TEMP, '17 °C', '26 °C'); }
    },
    co2: {
      name: 'Якість повітря (CO₂)',
      color: function (room, now) { if (!room.bookable && room.type !== 'library') return special(room) || GRAY; return U.scale(CO2, I3.read(room.id, now).co2); },
      legend: function () { return grad(CO2, '600 ppm', '1600 ppm'); }
    },
    presence: {
      name: 'Присутність людей',
      color: function (room, now) {
        var v = I3.read(room.id, now);
        if (!v.people) return special(room) || DIM;
        return U.scale([[1, 0xf3d28a], [15, 0xe28a3b], [40, 0xb5462a]], v.people);
      },
      legend: function () { return '<span class="k"><i style="background:#e1e5e8"></i>Нікого</span>' + grad([[1, 0xf3d28a], [15, 0xe28a3b], [40, 0xb5462a]], '1', '40+ осіб'); }
    },
    light: {
      name: 'Освітлення',
      color: function (room, now) {
        var v = I3.read(room.id, now);
        return v.lightLevel >= 0.9 ? 0xf5c84c : v.lightLevel > 0 ? 0xf0dfa0 : 0x5c6a74;
      },
      legend: function () {
        return '<span class="k"><i style="background:#f5c84c"></i>Увімкнено</span><span class="k"><i style="background:#f0dfa0"></i>Приглушено</span>' +
          '<span class="k"><i style="background:#5c6a74"></i>Вимкнено</span>';
      }
    },
    power: {
      name: 'Енергоспоживання',
      color: function (room, now) {
        var w = I3.read(room.id, now).power;
        return w < 30 ? DIM : U.scale([[30, 0xd7e6f3], [800, 0x7fb0dc], [2500, 0x1f5e99], [3500, 0x0d2f52]], w);
      },
      legend: function () { return grad([[30, 0xd7e6f3], [800, 0x7fb0dc], [2500, 0x1f5e99], [3500, 0x0d2f52]], '0 Вт', '3,5 кВт'); }
    }
  };

  var SC_COL = { lesson: 0x2e9e5b, presentation: 0x7b4fd0, exam: 0x0f8fa0, empty: 0xc7cdd1, night: 0x4a5560, blackout: 0xd49a00 };
  var EXTRA = [0xd9534f, 0x3b7dd8, 0x8a6d3b, 0xc2185b];
  function scColor(id) {
    if (SC_COL[id] != null) return SC_COL[id];
    var ids = SK.scenarios.list().map(function (s) { return s.id; }).filter(function (x) { return SC_COL[x] == null; });
    return EXTRA[Math.max(0, ids.indexOf(id)) % EXTRA.length];
  }

  function grad(stops, a, b) {
    var g = stops.map(function (s, i) { return U.hex(s[1]) + ' ' + Math.round(i / (stops.length - 1) * 100) + '%'; }).join(',');
    return '<span class="k">' + a + '</span><span class="gradient" style="background:linear-gradient(90deg,' + g + ')"></span><span class="k">' + b + '</span>';
  }

  return MODES;
})();
