/* Режими розфарбування 3D-карти та легенди до них (спільні для обох застосунків). */
SK.colorModes = (function () {
  var U = SK.util, S = SK.schedule, I3 = SK.i3;
  /* Нейтральні кольори залежать від теми: у темній — графітові, щоб яскравими були лише статуси */
  function dk() { return SK.theme && SK.theme.isDark(); }
  var NEU = { get gray() { return dk() ? 0x334252 : 0xc7cdd1; }, get dim() { return dk() ? 0x243140 : 0xe1e5e8; }, get svc() { return dk() ? 0x2b3846 : 0xd3d9de; } };
  var TEMP = [[17, 0x3b7dd8], [20, 0x5fb3a8], [22, 0x2e9e5b], [24, 0xd99a1e], [26, 0xd64545]];
  var CO2 = [[600, 0x2e9e5b], [900, 0x9fbf3a], [1200, 0xd99a1e], [1600, 0xd64545]];

  /* Службові приміщення (санвузли, курилки, технічні, хол) — один нейтральний колір: їх розрізняють підписи, а не кольори */
  function special(room) {
    if (room.type === 'wc' || room.type === 'smoking' || room.type === 'tech') return NEU.svc;
    if (room.type === 'hall') return NEU.dim;
    return null;
  }

  var MODES = {
    status: {
      name: 'Статус аудиторій',
      color: function (room, now) {
        var sp = special(room); if (sp != null) return sp;
        if (!room.bookable) return room.type === 'admin' || room.type === 'server' || room.type === 'electric' ? (dk() ? 0x1d6f80 : 0x9fd6e2) : NEU.gray;
        return S.STATUS[S.status(room.id, now).status].color;
      },
      legend: function () {
        return '<span class="k"><i style="background:var(--free)"></i>Вільна</span><span class="k"><i style="background:var(--busy)"></i>Зайнята</span>' +
          '<span class="k"><i style="background:var(--booked)"></i>Заброньована / подія</span>' +
          '<span class="k"><i style="background:' + U.hex(dk() ? 0x1d6f80 : 0x9fd6e2) + '"></i>Диспетчерська, серверна, щитова</span>' +
          '<span class="k"><i style="background:' + U.hex(NEU.svc) + '"></i>Службові</span>';
      }
    },
    scenario: {
      name: 'Активний сценарій',
      color: function (room, now) {
        if (!room.bookable) return special(room) || NEU.dim;
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
      color: function (room, now) { if (!room.bookable && room.type !== 'library') return special(room) || NEU.gray; return U.scale(CO2, I3.read(room.id, now).co2); },
      legend: function () { return grad(CO2, '600 ppm', '1600 ppm'); }
    },
    presence: {
      name: 'Присутність людей',
      color: function (room, now) {
        var v = I3.read(room.id, now);
        if (!v.people) return special(room) || NEU.dim;
        return U.scale([[1, 0xf3d28a], [15, 0xe28a3b], [40, 0xb5462a]], v.people);
      },
      legend: function () { return '<span class="k"><i style="background:' + U.hex(NEU.dim) + '"></i>Нікого</span>' + grad([[1, 0xf3d28a], [15, 0xe28a3b], [40, 0xb5462a]], '1', '40+ осіб'); }
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
        return w < 30 ? NEU.dim : U.scale(PWR(), w);
      },
      legend: function () { return grad(PWR(), '0 Вт', '3,5 кВт'); }
    }
  };

  /* Енергоспоживання: у темній темі — від темного до яскраво-бірюзового «світіння» */
  function PWR() { return dk() ? [[30, 0x1c3240], [800, 0x1b6f84], [2500, 0x22c3dd], [3500, 0xb8f3ff]] : [[30, 0xd7e6f3], [800, 0x7fb0dc], [2500, 0x1f5e99], [3500, 0x0d2f52]]; }
  var SC_COL = { lesson: 0x3ecf8e, presentation: 0x9b8cff, exam: 0x22c3dd, empty: 0x6c7f8f, night: 0x3a4a5c, blackout: 0xf2b84b };
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
