/* Адміністративні вкладки панелі: Події, Сценарії, Доступ, Живлення, Комутація.
 * Реєструються в SK.adminTabs; панель (dashboard.js) викликає їх як звичайні вкладки. */
SK.adminTabs = (function () {
  var U = SK.util, B = SK.building, S = SK.schedule, SEC = SK.security, SCN = SK.scenarios, PW = SK.power,
    W = SK.wiring, FL = SK.faults, DEV = SK.devicesI3, DS = SK.devices, UE = SK.uniEvents, store = SK.store, $ = U.$, esc = U.esc;
  function D() { return SK.dashboard; }
  var st = { scEdit: null, ruleEdit: null, accGroup: '', accDoor: 'D-MAIN', accUser: '', evEdit: null, wCab: null };

  /* =================== ПОДІЇ ТА ОГОЛОШЕННЯ =================== */
  function events(p) {
    var n = D().now(), list = UE.upcoming(new Date(n.getTime() - 86400000 * 7), 30), canE = SEC.can('events');
    var h = '<h2>Розклад подій</h2><div class="muted small">Події бачать студенти в застосунку. Подія з аудиторією автоматично бронює її (синій колір на карті).</div>';
    h += '<div class="tw"><table class="t"><thead><tr><th>Дата</th><th>Подія</th><th>Місце</th><th></th></tr></thead><tbody>' + list.map(function (e) {
      var past = e.date < U.dateKey(n);
      return '<tr' + (past ? ' style="opacity:.55"' : '') + '><td class="small">' + e.date.slice(8) + '.' + e.date.slice(5, 7) + '<br>' + e.start + '–' + e.end + '</td><td><b>' + esc(e.title) + '</b>' +
        '<div class="small muted">' + esc(UE.TYPES[e.type] || '') + ' · для: ' + esc(audName(e.audience)) + '</div></td><td class="small">' +
        (e.room ? '<a href="#" data-room="' + e.room + '">' + e.room + '</a>' : esc(e.place)) + '</td><td>' +
        (canE ? '<button class="btn small" data-ev-edit="' + e.id + '">✎</button><button class="btn small danger" data-ev-del="' + e.id + '">✕</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    if (canE) {
      var e0 = st.evEdit ? UE.list().filter(function (x) { return x.id === st.evEdit; })[0] : null;
      e0 = e0 || { title: '', type: 'lecture', date: U.dateKey(n), start: '14:40', end: '16:00', room: '', audience: 'all', desc: '' };
      h += '<h3>' + (st.evEdit ? 'Редагувати подію' : 'Нова подія') + '</h3><div class="form-grid">' +
        '<label style="grid-column:1/3">Назва<input type="text" id="evT" value="' + esc(e0.title) + '"></label>' +
        '<label>Тип' + D().sel('evType', Object.keys(UE.TYPES).map(function (k) { return [k, UE.TYPES[k]]; }), e0.type) + '</label>' +
        '<label>Дата<input type="date" id="evDate" value="' + e0.date + '"></label>' +
        '<label>Початок<input type="time" id="evS" value="' + e0.start + '"></label><label>Кінець<input type="time" id="evE" value="' + e0.end + '"></label>' +
        '<label>Аудиторія' + D().sel('evRoom', [['', '— без аудиторії —']].concat(B.bookableRooms().map(function (r) { return [r.id, r.id + ' · ' + r.name]; })), e0.room || '') + '</label>' +
        '<label>Для кого' + D().sel('evAud', audOptions(), e0.audience) + '</label>' +
        '<label style="grid-column:1/3">Опис<input type="text" id="evDesc" value="' + esc(e0.desc) + '"></label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn small primary" id="evSave">Зберегти</button>' + (st.evEdit ? '<button class="btn small" id="evNew">Нова</button>' : '') + '</div>';
    } else h += D().lockedNote('Створення подій');

    h += '<h2 style="margin-top:18px">Оголошення для студентів</h2>' + store.state.announcements.slice(0, 8).map(function (a) {
      return '<div class="small" style="margin-bottom:6px"><b>' + esc(a.from) + ':</b> ' + esc(a.text) + ' <span class="muted">' + U.fmtDateTime(new Date(a.ts)) + '</span>' +
        (SEC.can('announce') ? ' <button class="btn small" data-an-del="' + a.id + '">✕</button>' : '') + '</div>';
    }).join('');
    if (SEC.can('announce')) h += '<div class="row"><input type="text" id="annText" class="grow" placeholder="Текст оголошення"><button class="btn small primary" id="annSend">Надіслати</button></div>';
    p.innerHTML = h;
    D().bindRoomRows(p);
    p.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.evEdit) { st.evEdit = b.dataset.evEdit; D().renderPanel(); }
      if (b.dataset.evDel) { UE.remove(b.dataset.evDel); U.toast('Подію видалено'); }
      if (b.id === 'evNew') { st.evEdit = null; D().renderPanel(); }
      if (b.id === 'evSave') {
        var e = { id: st.evEdit, title: $('#evT', p).value.trim() || 'Подія', type: $('#evType', p).value, date: $('#evDate', p).value,
          start: $('#evS', p).value, end: $('#evE', p).value, room: $('#evRoom', p).value || null, audience: $('#evAud', p).value, desc: $('#evDesc', p).value };
        var err = UE.save(e);
        U.toast(err ? '✕ ' + err : 'Подію збережено — студенти побачать її в розкладі подій', err ? 'bad' : 'good');
        if (!err) st.evEdit = null;
      }
      if (b.dataset.anDel) { store.state.announcements = store.state.announcements.filter(function (a) { return a.id !== b.dataset.anDel; }); store.save(); }
      if (b.id === 'annSend') {
        var v = $('#annText', p).value.trim(); if (!v) return;
        store.state.announcements.unshift({ id: U.uid('an'), ts: Date.now(), text: v, from: 'Адміністрація корпусу' });
        store.save(); U.toast('Оголошення опубліковано', 'good');
      }
    };
  }
  function audOptions() {
    var o = [['all', 'Усі']];
    [1, 2, 3, 4].forEach(function (c) { o.push(['course:' + c, c + ' курс']); });
    SK.scheduleData.specialties.forEach(function (s) { o.push([s.code, s.name]); });
    S.groups.forEach(function (g) { o.push([g.id, 'Група ' + g.id]); });
    return o;
  }
  function audName(a) { var o = audOptions().filter(function (x) { return x[0] === a; })[0]; return o ? o[1] : a; }

  /* =================== СЦЕНАРІЇ =================== */
  function scenarios(p) {
    var n = D().now(), canS = SEC.can('scenarios'), canM = SEC.can('scenario');
    var counts = {}; B.bookableRooms().forEach(function (r) { var v = SK.i3.read(r.id, n); counts[v.effMode] = (counts[v.effMode] || 0) + 1; });
    var h = '<h2>Сценарії та правила</h2><div class="note">Для кожної аудиторії діє правило з найвищим пріоритетом, умова якого виконана. ' +
      'Сценарій задає параметри обладнання; на контролери Atom команда йде через MQTT. Карта: режим «Активний сценарій».</div>';

    /* --- Правила --- */
    h += '<h3>Правила (за пріоритетом)</h3><div class="tw"><table class="t"><thead><tr><th>Пр.</th><th>Правило</th><th>Сценарій</th><th></th></tr></thead><tbody>' +
      SCN.rules().map(function (r) {
        var sc = r.type === 'manual' ? '— обирається вручну' : esc(SCN.get(r.sc).name) + (r.hold ? '<div class="small muted">затримка: «' + esc(SCN.get(r.hold).name) + '»</div>' : '');
        return '<tr' + (r.on ? '' : ' style="opacity:.5"') + '><td><b>' + r.prio + '</b></td><td><b>' + esc(r.name) + '</b><div class="small muted">' + esc(SCN.RULE_TYPES[r.type].name) + ' · ' + esc(SCN.describeRule(r)) + '</div></td>' +
          '<td class="small">' + sc + '</td><td>' + (canS ? '<button class="btn small" data-r-tg="' + r.id + '">' + (r.on ? 'Вимк.' : 'Увімк.') + '</button>' +
          (r.system ? '' : '<button class="btn small" data-r-ed="' + r.id + '">✎</button>') : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (canS) h += ruleForm();

    /* --- Сценарії --- */
    h += '<h3>Сценарії</h3><div class="tw"><table class="t"><thead><tr><th>Сценарій</th><th>Параметри</th><th>Зараз</th><th></th></tr></thead><tbody>' +
      SCN.list().map(function (s) {
        return '<tr><td><b>' + esc(s.name) + '</b>' + (s.system ? '<div class="small muted">системний</div>' : '') + '</td><td class="small">' + paramText(s.p) + '</td>' +
          '<td>' + (counts[s.id] || 0) + ' ауд.</td><td>' + (canS ? '<button class="btn small" data-s-ed="' + s.id + '">✎</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (canS) h += scenarioForm();

    /* --- Масове ручне застосування --- */
    h += '<h3>Застосувати вручну</h3>';
    if (canM) {
      h += '<div class="form-grid"><label>Блок' + D().sel('maBlock', [['', 'Усі'], ['A', 'Блок А'], ['B', 'Блок Б']]) + '</label>' +
        '<label>Поверх' + D().sel('maFloor', [['', 'Усі'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]) + '</label>' +
        '<label>Тип' + D().sel('maType', [['', 'Усі аудиторії']].concat(Object.keys(B.types).filter(function (k) { return B.types[k].bookable; }).map(function (k) { return [k, B.types[k].name]; }))) + '</label>' +
        '<label>Сценарій' + D().sel('maSc', [['auto', 'Авто (зняти ручний)']].concat(SCN.list().map(function (s) { return [s.id, s.name]; }))) + '</label>' +
        '<label>Тривалість' + D().sel('maDur', [['90', '90 хв'], ['30', '30 хв'], ['240', '4 год'], ['', 'до скасування']]) + '</label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn small primary" id="maGo">Застосувати</button></div>';
    } else h += D().lockedNote('Ручне керування сценаріями');
    var ov = Object.keys(store.state.overrides).filter(function (id) { return SCN.override(id, n); });
    if (ov.length) h += '<div class="small" style="margin-top:6px">Ручні режими (' + ov.length + '): ' + ov.map(function (id) {
      var o = SCN.override(id, n); return '<a href="#" data-room="' + id + '">' + id + '</a> — ' + esc(SCN.get(o.sc).name) + (o.until ? ' до ' + U.hhmm(new Date(o.until)) : '');
    }).join(', ') + (canM ? ' <button class="btn small" id="ovClear">Скасувати всі</button>' : '') + '</div>';

    h += '<h3>Журнал змін</h3>' + (store.state.scLog.length ? '<div class="small">' + store.state.scLog.slice(0, 12).map(function (l) {
      return U.fmtDateTime(new Date(l.ts)) + ' · ' + esc(l.text) + ' <span class="muted">(' + esc(l.by) + ')</span>';
    }).join('<br>') + '</div>' : '<div class="small muted">Змін ще не було.</div>');
    if (canS) h += '<div class="row" style="margin-top:10px"><button class="btn small danger" id="scReset">Відновити типові сценарії й правила</button></div>';

    p.innerHTML = h;
    D().bindRoomRows(p);
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rTg) SCN.toggleRule(b.dataset.rTg);
      if (b.dataset.rEd) { st.ruleEdit = b.dataset.rEd; D().renderPanel(); }
      if (b.dataset.sEd) { st.scEdit = b.dataset.sEd; D().renderPanel(); }
      if (b.id === 'rNew') { st.ruleEdit = null; D().renderPanel(); }
      if (b.id === 'sNew') { st.scEdit = null; D().renderPanel(); }
      if (b.id === 'rSave') saveRule(p);
      if (b.id === 'rDel') { var er = SCN.deleteRule(st.ruleEdit); U.toast(er || 'Правило видалено', er ? 'bad' : 'good'); if (!er) st.ruleEdit = null; }
      if (b.id === 'sSave2') saveSc(p);
      if (b.id === 'sDel') { var es = SCN.deleteScenario(st.scEdit); U.toast(es || 'Сценарій видалено', es ? 'bad' : 'good'); if (!es) st.scEdit = null; }
      if (b.id === 'maGo') {
        var ids = B.bookableRooms().filter(function (r) {
          return (!$('#maBlock', p).value || r.block === $('#maBlock', p).value) && (!$('#maFloor', p).value || r.floor === +$('#maFloor', p).value) &&
            (!$('#maType', p).value || r.type === $('#maType', p).value);
        }).map(function (r) { return r.id; });
        SCN.apply(ids, $('#maSc', p).value, $('#maDur', p).value ? +$('#maDur', p).value : null);
        U.toast('Застосовано до ' + ids.length + ' аудиторій', 'good');
      }
      if (b.id === 'ovClear') SCN.apply(Object.keys(store.state.overrides), 'auto');
      if (b.id === 'scReset') { if (b.dataset.armed) { SCN.reset(); st.scEdit = st.ruleEdit = null; } else { b.dataset.armed = 1; b.textContent = 'Натисніть ще раз для підтвердження'; } }
    };
  }
  function paramText(p) {
    return Object.keys(SCN.PARAMS).map(function (k) {
      var d = SCN.PARAMS[k], v = p[k];
      return d.name + ': ' + (d.type === 'bool' ? (v ? 'так' : 'ні') : d.type === 'opt' ? d.opts[v] : v + (d.unit ? ' ' + d.unit : ''));
    }).join(' · ');
  }
  function scenarioForm() {
    var s = st.scEdit ? SCN.get(st.scEdit) : { name: 'Новий сценарій', p: JSON.parse(JSON.stringify(SCN.get('lesson').p)) };
    var h = '<div class="card" style="box-shadow:none;margin-top:8px"><b>' + (st.scEdit ? 'Редагування: ' + esc(s.name) : 'Новий сценарій') + '</b><div class="form-grid" style="margin-top:6px">' +
      '<label style="grid-column:1/3">Назва<input type="text" id="sName" value="' + esc(s.name) + '"></label>';
    Object.keys(SCN.PARAMS).forEach(function (k) {
      var d = SCN.PARAMS[k], v = s.p[k];
      if (d.type === 'num') h += '<label>' + d.name + ', ' + d.unit + '<input type="number" id="sp_' + k + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '"></label>';
      else if (d.type === 'bool') h += '<label>' + d.name + D().sel('sp_' + k, [['1', 'увімкнено'], ['0', 'вимкнено']], v ? '1' : '0') + '</label>';
      else h += '<label>' + d.name + D().sel('sp_' + k, Object.keys(d.opts).map(function (o) { return [o, d.opts[o]]; }), v) + '</label>';
    });
    h += '</div><div class="row" style="margin-top:8px"><button class="btn small primary" id="sSave2">Зберегти сценарій</button>' +
      (st.scEdit ? '<button class="btn small" id="sNew">Новий</button>' + (s.system ? '' : '<button class="btn small danger" id="sDel">Видалити</button>') : '') + '</div></div>';
    return h;
  }
  function saveSc(p) {
    var s = { id: st.scEdit, name: $('#sName', p).value.trim() || 'Сценарій', p: {} };
    Object.keys(SCN.PARAMS).forEach(function (k) {
      var d = SCN.PARAMS[k], v = $('#sp_' + k, p).value;
      s.p[k] = d.type === 'num' ? U.clamp(+v, d.min, d.max) : d.type === 'bool' ? v === '1' : v;
    });
    if (st.scEdit) s.system = SCN.get(st.scEdit).system;
    st.scEdit = SCN.saveScenario(s);
    U.toast('Сценарій «' + s.name + '» збережено', 'good');
  }
  function ruleForm() {
    var r = st.ruleEdit ? SCN.rules().filter(function (x) { return x.id === st.ruleEdit; })[0] : null;
    r = r || { name: 'Нове правило', type: 'time', sc: 'exam', prio: 60, on: true, days: [1, 2, 3, 4, 5], from: '08:20', to: '09:40', minutes: 10, before: 10, target: {} };
    var t = r.target || {};
    var h = '<div class="card" style="box-shadow:none;margin-top:8px"><b>' + (st.ruleEdit ? 'Редагування правила' : 'Нове правило') + '</b><div class="form-grid" style="margin-top:6px">' +
      '<label style="grid-column:1/3">Назва<input type="text" id="rName" value="' + esc(r.name) + '"></label>' +
      '<label>Умова' + D().sel('rType', Object.keys(SCN.RULE_TYPES).filter(function (k) { return k !== 'manual'; }).map(function (k) { return [k, SCN.RULE_TYPES[k].name]; }), r.type) + '</label>' +
      '<label>Сценарій' + D().sel('rSc', SCN.list().map(function (s) { return [s.id, s.name]; }), r.sc) + '</label>' +
      '<label>Пріоритет (1–99)<input type="number" id="rPrio" min="1" max="99" value="' + r.prio + '"></label>' +
      '<label>Дні (для «за часом»)<input type="text" id="rDays" value="' + (r.days || []).join(',') + '" placeholder="1,2,3 (Пн=1)"></label>' +
      '<label>Від<input type="time" id="rFrom" value="' + (r.from || '08:00') + '"></label><label>До<input type="time" id="rTo" value="' + (r.to || '18:00') + '"></label>' +
      '<label>Хв без людей / до пари<input type="number" id="rMin" min="0" max="120" value="' + (r.type === 'schedule' ? r.before || 0 : r.minutes || 10) + '"></label>' +
      '<label>Аудиторії (через кому)<input type="text" id="rRooms" value="' + esc((t.rooms || []).join(', ')) + '" placeholder="порожньо — усі"></label>' +
      '<label>Блоки' + D().sel('rBlock', [['', 'усі'], ['A', 'А'], ['B', 'Б']], (t.blocks || [])[0] || '') + '</label>' +
      '<label>Поверхи<input type="text" id="rFloors" value="' + (t.floors || []).join(',') + '" placeholder="1,2"></label>' +
      '<label style="grid-column:1/3">Типи приміщень' + D().sel('rTypes', [['', 'усі']].concat(Object.keys(B.types).filter(function (k) { return B.types[k].bookable; }).map(function (k) { return [k, B.types[k].name]; })), (t.types || [])[0] || '') + '</label>' +
      '</div><div class="small muted" style="margin-top:4px">' + Object.keys(SCN.RULE_TYPES).map(function (k) { return '<b>' + SCN.RULE_TYPES[k].name + '</b> — ' + esc(SCN.RULE_TYPES[k].desc); }).join('; ') + '.</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" id="rSave">Зберегти правило</button>' +
      (st.ruleEdit ? '<button class="btn small" id="rNew">Нове</button><button class="btn small danger" id="rDel">Видалити</button>' : '') + '</div></div>';
    return h;
  }
  function saveRule(p) {
    var nums = function (s) { return s.split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); }); };
    var old = st.ruleEdit ? SCN.rules().filter(function (x) { return x.id === st.ruleEdit; })[0] : null;
    var type = $('#rType', p).value, mins = +$('#rMin', p).value || 0;
    var r = { id: st.ruleEdit, name: $('#rName', p).value.trim() || 'Правило', type: type, sc: $('#rSc', p).value,
      prio: U.clamp(+$('#rPrio', p).value || 50, 1, 99), on: old ? old.on : true,
      days: nums($('#rDays', p).value), from: $('#rFrom', p).value, to: $('#rTo', p).value,
      minutes: type === 'empty' ? mins : undefined, before: type === 'schedule' ? mins : undefined, hold: type === 'empty' ? (old && old.hold || 'lesson') : undefined,
      target: {
        rooms: $('#rRooms', p).value.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return B.room(x); }),
        blocks: $('#rBlock', p).value ? [$('#rBlock', p).value] : [], floors: nums($('#rFloors', p).value),
        types: $('#rTypes', p).value ? [$('#rTypes', p).value] : []
      } };
    if (type === 'time' && !r.days.length) { U.toast('Вкажіть дні тижня для правила «за часом»', 'bad'); return; }
    SCN.saveRule(r); st.ruleEdit = null;
    U.toast('Правило «' + r.name + '» збережено', 'good');
  }

  /* =================== ДОСТУП ЗА ВІДБИТКАМИ =================== */
  function access(p) {
    var n = D().now(), canA = SEC.can('access'), users = SEC.users();
    var h = '<h2>Безключовий доступ за відбитками пальців</h2>' +
      '<div class="note"><b>Біометрія — чутливі персональні дані.</b> Шаблони відбитків (не зображення) зберігаються лише в зашифрованому вигляді на сервері доступу ' +
      'й не передаються в систему «Розумного корпусу». Потрібна письмова згода; для тих, хто не погоджується, — картка або PIN. У прототипі користувачі знеособлені (U-0001…). ' +
      'Двері на шляхах евакуації розблоковує сертифікована система пожежної сигналізації. При відключенні живлення зчитувачі й замки працюють від ДБЖ шаф.</div>';
    h += '<div class="kpis">' + D().kpi(SEC.doors.length, 'дверей зі зчитувачами') + D().kpi(users.filter(function (u) { return u.prints && u.active; }).length, 'активних відбитків') +
      D().kpi(users.filter(function (u) { return !u.prints; }).length, 'без біометрії (картка/PIN)') +
      D().kpi(store.state.accessLog.filter(function (l) { return !l.ok; }).length, 'відмов у журналі', 'var(--warn)') + '</div>';

    /* Симуляція проходу */
    h += '<h3>Симуляція проходу</h3><div class="form-grid"><label>Двері' + D().sel('acDoor', SEC.doors.map(function (d) { return [d.id, d.name]; }), st.accDoor) + '</label>' +
      '<label>Відбиток' + D().sel('acUser', [['', 'Невідомий відбиток']].concat(users.map(function (u) { return [u.id, u.id + ' · ' + SEC.GROUPS[u.group].name + (u.prints ? '' : ' (без біометрії)')]; })), st.accUser) + '</label></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" id="acTry">☝ Прикласти палець</button><span class="small muted">Права перевіряються за групою, зоною й часом; студентам — лише заброньовані аудиторії.</span></div>';

    /* Двері */
    h += '<h3>Двері та режими</h3><div class="tw"><table class="t"><tbody>' + SEC.doors.map(function (d) {
      var m = SEC.doorMode(d.id), last = store.state.accessLog.filter(function (l) { return l.door === d.id; })[0];
      return '<tr class="click" data-room="' + d.room + '"><td class="small"><b>' + esc(d.name) + '</b><div class="muted">' + esc(SEC.ZONES[d.zone]) + '</div></td>' +
        '<td class="small">' + (last ? (last.ok ? '<span class="lvl good">' : '<span class="lvl warn">') + U.hhmm(new Date(last.ts)) + ' ' + esc(last.user) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (canA ? D().sel('dm_' + d.id, [['auto', 'за відбитком'], ['open', 'відчинено'], ['locked', 'заблоковано']], m).replace('<select', '<select data-door="' + d.id + '"') : esc(m)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

    if (canA) {
    /* Групи */
    h += '<h3>Групи доступу</h3><table class="t"><tbody>' + Object.keys(SEC.GROUPS).map(function (k) {
      var g = SEC.GROUPS[k];
      return '<tr><td><b>' + esc(g.name) + '</b><div class="small muted">' + g.zones.map(function (z) { return SEC.ZONES[z]; }).join('; ') + '</div></td>' +
        '<td class="small">' + g.days.map(function (d) { return U.DAYS_SHORT[d]; }).join(' ') + '<br>' + g.from + '–' + g.to + (g.extra ? ', ' + g.extra.join('–') : '') + '</td>' +
        '<td>' + users.filter(function (u) { return u.group === k; }).length + '</td></tr>';
    }).join('') + '</tbody></table>';

    /* Користувачі */
    var ul = users.filter(function (u) { return !st.accGroup || u.group === st.accGroup; });
    h += '<h3>Користувачі (знеособлено)</h3><div class="row" style="margin-bottom:6px">' + D().sel('acGroup', [['', 'Усі групи']].concat(Object.keys(SEC.GROUPS).map(function (k) { return [k, SEC.GROUPS[k].name]; })), st.accGroup) +
      (canA ? '<button class="btn small" id="acAdd">+ Користувач</button>' : '') + '</div><div class="tw"><table class="t"><tbody>' + ul.map(function (u) {
        return '<tr' + (u.active ? '' : ' style="opacity:.5"') + '><td><b>' + u.id + '</b><div class="small muted">' + esc(SEC.GROUPS[u.group].name) + '</div></td>' +
          '<td class="small">' + (u.prints ? '☝ ' + u.prints + ' відбит.' : '<span class="lvl warn">немає</span>') + (u.alt ? '<br>+ ' + esc(u.alt) : '') + '</td>' +
          '<td>' + (canA ? '<button class="btn small" data-en="' + u.id + '"' + (u.prints >= 2 ? ' disabled' : '') + '>Зареєструвати</button><button class="btn small" data-rv="' + u.id + '">Видалити шаблон</button>' +
            '<button class="btn small" data-bl="' + u.id + '">' + (u.active ? 'Блок.' : 'Розблок.') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    if (!canA) h += D().lockedNote('Керування користувачами, групами доступу й шаблонами відбитків');

    /* Журнал */
    h += '<h3>Журнал проходів</h3>' + (store.state.accessLog.length ? '<div class="tw"><table class="t"><tbody>' + store.state.accessLog.slice(0, 30).map(function (l) {
      var d = SEC.door(l.door);
      return '<tr><td class="small">' + U.fmtDateTime(new Date(l.ts)) + '</td><td class="small"><b>' + esc(d ? d.name : l.door) + '</b><br>' + esc(l.user) + '</td>' +
        '<td class="small"><span class="lvl ' + (l.ok ? 'good' : 'bad') + '">' + (l.ok ? 'дозволено' : 'відмова') + '</span><br>' + esc(l.reason) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="small muted">Порожньо — спробуйте симуляцію проходу.</div>');
    p.innerHTML = h;
    D().bindRoomRows(p);
    if ($('#acGroup', p)) $('#acGroup', p).onchange = function (e) { st.accGroup = e.target.value; D().renderPanel(); };
    $('#acDoor', p).onchange = function (e) { st.accDoor = e.target.value; };
    $('#acUser', p).onchange = function (e) { st.accUser = e.target.value; };
    p.onchange = function (e) { if (e.target.dataset.door) { SEC.setDoor(e.target.dataset.door, e.target.value); U.toast('Режим дверей змінено (симуляція)', 'good'); } };
    p.onclick = function (e) {
      if (e.target.tagName === 'SELECT') return;
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'acTry') {
        var r = SEC.attempt(st.accUser || null, st.accDoor);
        U.toast((r.ok ? '🔓 ' : '⛔ ') + r.reason, r.ok ? 'good' : 'bad');
        if (!r.ok || true) D().renderPanel();
      }
      if (b.dataset.en) { SEC.enroll(b.dataset.en); U.toast('Відбиток зареєстровано (симуляція, потрібна згода)', 'good'); }
      if (b.dataset.rv) { SEC.revoke(b.dataset.rv); U.toast('Шаблон відбитка видалено з контролера доступу'); }
      if (b.dataset.bl) SEC.block(b.dataset.bl);
      if (b.id === 'acAdd') { var id = SEC.addUser(st.accGroup || 'teachers'); U.toast('Створено ' + id + '. Зареєструйте відбиток після підписання згоди.'); }
    };
  }

  /* =================== ДИСПЕТЧЕРСЬКА (А-001) =================== */
  var CT = SK.control;
  function setCtlRoom(id) { if (B.room(id)) { st.ctlRoom = id; if (D().ui.tab === 'control') D().renderPanel(); } }
  function pwrBtn(d, n) {
    var off = CT.isOff(d), iss = FL.deviceIssue(d, n), dis = !SEC.can('scenario');
    return '<button class="pwr' + (off ? ' off' : '') + '" data-pwr="' + esc(d.id) + '"' + (dis ? ' disabled' : '') +
      ' title="' + esc((off ? 'Увімкнути / повернути в роботу: ' : (CT.POWER[d.kind] ? 'Вимкнути вручну: ' : 'Вивести з роботи: ')) + d.name + (iss ? ' · ' + iss.value : '')) + '" aria-label="' + (off ? 'Увімкнути' : 'Вимкнути') + '">' + SK.PWR_ICON + '</button>';
  }
  function control(p) {
    var n = D().now(), adm = SEC.can('doors'), canS = SEC.can('scenario');
    var r = B.room(st.ctlRoom || D().ui.room || 'А-201') || B.room('А-201'); st.ctlRoom = r.id;
    var fs = FL.summary(n), ps = PW.state(n), alarms = SEC.active().filter(function (e) { return e.sev === 'critical' || e.sev === 'serious'; }).length;
    var offs = CT.offList(), offIds = Object.keys(offs);
    var h = '<div class="row"><h2 class="grow">Диспетчерська · А-001</h2><button class="btn small" data-ct="admRoom" title="Показати адміністративне приміщення на карті">◎ А-001 на карті</button></div><div class="small muted">Робоче місце оператора: стан корпусу, ручне керування пристроями й дверима, журнал команд.</div>';
    h += '<div class="kpis">' + D().kpi(alarms, 'тривог', alarms ? 'var(--bad)' : null) + D().kpi(fs.any, 'несправностей', fs.any ? 'var(--warn)' : null) +
      D().kpi(offIds.length, 'вимкнено вручну') + D().kpi('<span class="lvl ' + (ps.grid ? 'good' : ps.genOn ? 'warn' : 'bad') + '">' + esc(ps.grid ? 'мережа' : ps.genOn ? 'ДГУ' : 'ДБЖ') + '</span>', 'живлення') + '</div>';
    h += '<h3>Як проходить команда</h3><div class="chain">' + ['👤 Оператор А-001', '🗄 Сервер А-002', '📡 MQTT …/set', '⚡ Шафа ЩА', '🔌 Контролер · порт', '💡 Пристрій', '✓ Підтвердження ≤ 2 с']
      .map(function (x) { return '<span>' + x + '</span>'; }).join('<i>→</i>') + '</div>';

    /* --- Приміщення --- */
    var rooms = B.rooms.slice().sort(function (a, b) { return a.block < b.block ? -1 : a.block > b.block ? 1 : a.floor - b.floor || (a.id < b.id ? -1 : 1); });
    h += '<h3>Керування приміщенням</h3><div class="row">' + D().sel('ctRoom', rooms.map(function (x) { return [x.id, x.id + ' · ' + x.name]; }), r.id) +
      '<button class="btn small" data-ct="map" title="Показати на карті">◎</button>' + (SEC.can('scenario') ? '<button class="btn small" data-ct="model" title="Модель кімнати">🔍</button>' : '') + '</div>';
    var v = SK.i3.read(r.id, n), devs = DEV.roomDevices(r).filter(CT.controllable);
    h += '<div class="small muted" style="margin:4px 0">' + esc(B.blockById(r.block).name) + ', поверх ' + r.floor + ' · сценарій «' + esc(v.scName) + '» · ' + v.people + ' ос. · ' + v.temp + ' °C</div>';
    if (devs.length) {
      h += '<div class="ctl-list">' + devs.map(function (d) {
        var s = DS.state(d, n);
        return '<div class="ctl-item' + (CT.isOff(d) ? ' is-off' : '') + '">' + pwrBtn(d, n) + '<div class="grow"><div>' + DEV.KINDS[d.kind].icon + ' ' + esc(d.name) + '</div>' +
          '<div class="small muted">' + esc(s.value || '') + ' · <span class="lvl ' + DS.STATUS[s.status].lvl + '">' + DS.STATUS[s.status].name + '</span></div></div></div>';
      }).join('') + '</div>';
      if (canS) h += '<div class="row" style="margin-top:6px"><button class="btn small" data-ct="roomOff">' + SK.PWR_ICON + ' Вимкнути все в приміщенні</button><button class="btn small" data-ct="roomOn">Увімкнути все</button></div>';
    } else h += '<div class="small muted">У приміщенні немає керованих пристроїв.</div>';

    var dr = SEC.door('D-' + r.id);
    if (dr) {
      var mode = SEC.doorMode(dr.id), stt = SEC.doorState(dr.id);
      h += '<h3>Двері ' + esc(r.id) + '</h3><div class="small">Зараз: <b>' + (stt === 'open' ? 'відчинено' : 'зачинено') + '</b> · режим: ' + esc(CT.DOOR_ACT[mode] || mode) + ' · зона: ' + esc(SEC.ZONES[dr.zone]) + '</div>';
      if (canS) h += (dr.closed ? '<input type="text" id="ctReason" placeholder="Причина (обов’язково для закритої зони)" style="width:100%;margin-top:6px">' : '') +
        '<div class="row" style="margin-top:6px">' + Object.keys(CT.DOOR_ACT).map(function (a) {
          var allowed = adm || (a === 'pulse' && !dr.closed);
          return '<button class="btn small' + (mode === a ? ' on' : '') + '" data-door="' + a + '"' + (allowed ? '' : ' disabled title="Лише адміністратор"') + '>' + esc(CT.DOOR_ACT[a]) + '</button>';
        }).join('') + '</div>';
    }

    /* --- Поверх --- */
    if (canS) {
      h += '<h3>Поверх</h3><div class="row">' + D().sel('ctBlock', [['A', 'Блок А'], ['B', 'Блок Б']], st.ctBlock || (r.block === 'B' ? 'B' : 'A')) +
        D().sel('ctFloor', [0, 1, 2, 3, 4].map(function (f) { return [String(f), f === 0 ? '0 (хол)' : f + ' поверх']; }), String(st.ctFloor != null ? st.ctFloor : r.floor)) +
        '<button class="btn small" data-ct="flOff">' + SK.PWR_ICON + ' Вимкнути світло в аудиторіях</button><button class="btn small" data-ct="flOn">Увімкнути</button></div>';
    }

    /* --- Ручні вимкнення --- */
    h += '<h3>Вимкнено вручну (' + offIds.length + ')</h3>' + (offIds.length ? '<div class="ctl-list">' + offIds.slice(0, 30).map(function (id) {
      var d = DEV.device(id); if (!d) return '';
      return '<div class="ctl-item is-off">' + pwrBtn(d, n) + '<div class="grow"><a href="#" data-goroom="' + esc(d.room || '') + '">' + esc(d.room || d.label || d.id) + '</a> · ' + esc(d.name) +
        '<div class="small muted">' + esc(offs[id].by) + ', ' + U.fmtDateTime(new Date(offs[id].ts)) + '</div></div></div>';
    }).join('') + '</div>' + (canS ? '<div class="row" style="margin-top:6px"><button class="btn small" data-ct="clearAll">Скасувати всі ручні вимкнення</button></div>' : '') :
      '<div class="small muted">Немає. Ручне вимкнення має пріоритет над сценаріями, доки його не скасують.</div>');

    /* --- Журнал команд --- */
    var lg = CT.log();
    h += '<h3>Журнал команд</h3>' + (lg.length ? '<div class="tw"><table class="t"><tbody>' + lg.slice(0, 25).map(function (c) {
      return '<tr><td class="small">' + U.hhmm(new Date(c.ts)) + '</td><td class="small"><b>' + esc(c.text) + '</b><div class="muted">' + esc(c.route || '') + '</div></td>' +
        '<td class="small"><span class="lvl ' + (c.ok ? 'good' : 'bad') + '">' + esc(c.ok ? 'виконано' : 'не виконано') + '</span>' + (c.ok ? '' : '<div class="muted">' + esc(c.result) + '</div>') + '<div class="muted">' + esc(c.by) + '</div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="small muted">Команд ще не було.</div>');

    h += '<div class="note">Правила: команда доходить до пристрою лише через живу шафу й контролер — інакше «не доставлено» з причиною. Двері на шляхах евакуації ' +
      'розблоковує пожежна система. Закриті зони (серверна, електрощитова) — дистанційно лише адміністратор і з причиною. Усі команди — в журналі з автором.</div>';
    p.innerHTML = h;
    D().bindRoomRows(p);
    $('#ctRoom', p).onchange = function (e) { st.ctlRoom = e.target.value; D().renderPanel(); };
    var cb = $('#ctBlock', p); if (cb) cb.onchange = function (e) { st.ctBlock = e.target.value; };
    var cf = $('#ctFloor', p); if (cf) cf.onchange = function (e) { st.ctFloor = +e.target.value; };
    p.onclick = function (e) {
      var a = e.target.closest('[data-goroom]'); if (a) { e.preventDefault(); if (a.dataset.goroom) setCtlRoom(a.dataset.goroom); return; }
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      var res;
      if (b.dataset.pwr) { res = CT.toggle(DEV.device(b.dataset.pwr)); toastCmd(res); }
      if (b.dataset.door) { var rs = $('#ctReason', p); res = CT.door('D-' + r.id, b.dataset.door, rs ? rs.value.trim() : ''); toastCmd(res); }
      if (b.dataset.ct === 'admRoom') { var ar = B.adminRoom(); D().setFloorBtn(ar.floor); D().viewer.setFloor(ar.floor); D().viewer.select(ar.id); D().viewer.focusRoom(ar.id); }
      if (b.dataset.ct === 'map') { D().setFloorBtn(r.floor); D().viewer.setFloor(r.floor); D().viewer.select(r.id); D().viewer.focusRoom(r.id); }
      if (b.dataset.ct === 'model') SK.RoomView.open(r.id);
      if (b.dataset.ct === 'roomOff' || b.dataset.ct === 'roomOn') { var x = CT.roomPower(r.id, b.dataset.ct === 'roomOff'); U.toast(x.total - x.failed + ' з ' + x.total + ' команд виконано', x.failed ? 'warn' : 'good'); }
      if (b.dataset.ct === 'flOff' || b.dataset.ct === 'flOn') {
        var y = CT.floorLights($('#ctBlock', p).value, +$('#ctFloor', p).value, b.dataset.ct === 'flOff');
        U.toast('Світло: ' + (y.total - y.failed) + ' з ' + y.total + ' груп', y.failed ? 'warn' : 'good');
      }
      if (b.dataset.ct === 'clearAll') CT.clearAll();
    };
  }
  function toastCmd(res) { if (res) U.toast((res.ok ? '✓ ' : '✕ ') + res.text + (res.ok ? '' : ' — ' + res.result), res.ok ? 'good' : 'bad'); }

  /* =================== ЖИВЛЕННЯ =================== */
  function power(p) {
    var n = D().now(), s = PW.state(n), canP = SEC.can('power'), Dd = PW.DESIGN;
    var lvl = s.grid ? 'good' : s.genOn ? 'warn' : 'bad';
    var cabs = DEV.cabinets.map(function (c) { return { c: c, x: PW.cabState(c.id, n) }; });
    var onBatt = cabs.filter(function (k) { return k.x.online && !k.x.feedOk; }).length, off = cabs.filter(function (k) { return !k.x.online; }).length;
    var minLeft = cabs.filter(function (k) { return !k.x.feedOk && k.x.online; }).reduce(function (a, k) { return Math.min(a, k.x.leftMin); }, Infinity);
    var lt = PW.lastTest();
    var h = '<h2>Резервне живлення</h2><div class="muted small">Три рівні резерву: ДГУ через АВР (години) → центральний ДБЖ (сервер, мережа, диспетчерська) → ДБЖ кожної шафи (контролери, датчики, замки). ' +
      'Потужності орієнтовні. <span class="demo-badge">симуляція</span></div>';
    h += '<div class="kpis" style="margin-top:8px">' + D().kpi('<span class="lvl ' + lvl + '">' + esc(s.source) + '</span>', 'джерело зараз') +
      D().kpi(esc(s.gen), 'ДГУ', s.genFault || s.atsFault ? 'var(--bad)' : null) + D().kpi(s.fuel + ' %', 'паливо ДГУ', s.fuel <= 25 ? 'var(--warn)' : null) +
      D().kpi(s.upsCFault ? 'АКБ ✕' : Math.round(s.upsC) + ' %', 'центральний ДБЖ' + (s.grid ? '' : ' · ~' + s.upsCLeftMin + ' хв'), s.upsCFault || s.upsC < 25 ? 'var(--bad)' : null) +
      D().kpi((DEV.cabinets.length - onBatt - off) + ' / ' + DEV.cabinets.length, 'шаф від мережі/ДГУ') +
      (onBatt ? D().kpi(onBatt, 'шаф на батареї · мін. ~' + minLeft + ' хв', 'var(--warn)') : '') + (off ? D().kpi(off, 'шаф знеструмлено', 'var(--bad)') : '') +
      (s.grid ? '' : D().kpi(Math.round(s.minutes) + ' хв', 'без мережі')) + '</div>';
    if (!s.grid) h += '<div class="note" style="border-left-color:var(--' + (s.genOn ? 'warn' : 'bad') + ')">Аудиторії — у сценарії «Резервне живлення» (правило з пріоритетом 100), категорія III вимкнена.' +
      (s.genFail ? ' <b>' + (s.atsFault ? 'АВР не перемкнув' : 'ДГУ не запустилася') + ':</b> сервер — від центрального ДБЖ (~' + s.upsCLeftMin + ' хв), шафи — від власних ДБЖ.' : '') +
      (s.serverDown ? ' <b>Сервер вимкнено коректно</b>; контролери працюють автономно.' : '') + '</div>';

    if (canP) {
      h += '<h3>Імітація</h3><div class="row">' + (s.grid ? '<button class="btn small danger" id="pwOff">⚡ Зникла мережа</button>' : '<button class="btn small primary" id="pwOn">✓ Відновити мережу</button>') +
        '<button class="btn small" id="pwTest"' + (s.grid ? '' : ' disabled') + '>▶ Тестовий пуск ДГУ (15 хв)</button></div>' +
        '<div class="small muted" style="margin:4px 0">Останній тест ДГУ: ' + (lt ? U.fmtDateTime(new Date(lt)) : 'не проводився') + '. Рекомендовано щотижня.</div>' +
        '<div class="row">' + Object.keys(PW.FAULTS).map(function (k) {
          var on = (SK.store.state.power.faults || {})[k];
          return '<button class="btn small' + (on ? ' danger on' : '') + '" data-pf="' + k + '">' + (on ? '✕ ' : '') + esc(PW.FAULTS[k]) + '</button>';
        }).join('') + '</div><div class="small muted" style="margin-top:4px">Натисніть, щоб імітувати несправність обладнання; повторно — усунути. Несправності шаф і контролерів — у вкладці «Комутація».</div>';
    } else h += D().lockedNote('Імітація відключень і несправностей');

    h += '<h3>Однолінійна схема</h3>' + diagram(s, onBatt, off);

    h += '<h3>Шафи автоматики</h3><div class="tw"><table class="t"><thead><tr><th>Шафа</th><th>Ввід</th><th>ДБЖ шафи</th><th>Зв’язок</th></tr></thead><tbody>' + cabs.map(function (k) {
      var x = k.x, cl = !x.online ? 'bad' : !x.feedOk || x.upsFault ? 'warn' : 'good';
      return '<tr class="click" data-cab="' + esc(k.c.id) + '"><td><b>' + esc(k.c.id) + '</b></td><td class="small">' + (x.feedOk ? esc(x.src) : '<span class="lvl bad">немає</span>') + '</td>' +
        '<td class="small"><span class="lvl ' + cl + '">' + (x.upsFault ? 'АКБ несправні' : x.batt + ' %') + '</span>' + (!x.feedOk && x.online ? ' · ~' + x.leftMin + ' хв' : !x.online ? ' · offline' : '') + '</td>' +
        '<td class="small">' + (x.uplink ? 'норма' : '<span class="lvl bad">обрив</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div><div class="small muted">Клік — відкрити шафу в «Комутації» (там можна імітувати обрив вводу, несправність АКБ і зв’язку).</div>';

    h += '<h3>Категорії навантажень</h3><table class="t"><tbody>' + Object.keys(PW.CATS).map(function (k) {
      var c = PW.CATS[k], on = s.grid || (k === 'I' ? true : s.genOn && k !== 'III');
      return '<tr><td><b>' + esc(c.name) + '</b><div class="small muted">' + esc(c.items) + '</div></td><td class="small">' + esc(c.src) + (c.kw ? '<br>≈ ' + c.kw + ' кВт' : '') + '</td>' +
        '<td><span class="lvl ' + (on ? 'good' : 'warn') + '">' + (on ? 'живиться' : 'вимкнено') + '</span></td></tr>';
    }).join('') + '</tbody></table>';

    h += '<h3>Обладнання</h3><table class="t"><tbody>' + Object.keys(Dd).map(function (k) {
      var x = Dd[k];
      return '<tr><td><b>' + esc(x.name) + '</b><div class="small muted">' + esc(x.where) + '</div></td><td class="small">' + esc(x.feeds || (x.autonomyMin ? 'автономія ≈ ' + x.autonomyMin + ' хв' : '')) + '</td></tr>';
    }).join('') + '</tbody></table>';
    h += '<div class="note">Принципи: (1) кожна шафа має власний ДБЖ, тому контролери, зчитувачі й замки працюють навіть без мережі, ДГУ і сервера; ' +
      '(2) сервер вимикається коректно при заряді ≤ 10 %; (3) стан ДБЖ, АВР і ДГУ — через Modbus у Atom Cobalt, події — у журнал; ' +
      '(4) щотижневий тестовий пуск ДГУ; (5) аварійне освітлення й пожежна сигналізація — окремі сертифіковані системи з власними АКБ.</div>';
    p.innerHTML = h;
    p.onclick = function (e) {
      var b = e.target.closest('button');
      if (b) {
        if (b.id === 'pwOff') PW.startOutage(false);
        if (b.id === 'pwOn') PW.restore();
        if (b.id === 'pwTest') U.toast(PW.genTest() ? 'Тестовий пуск ДГУ — 15 хв' : 'Тест не вдався — див. журнал', 'warn');
        if (b.dataset.pf) PW.toggleFault(b.dataset.pf);
        return;
      }
      var tr = e.target.closest('[data-cab]');
      if (tr && SEC.can('settings')) { D().ui.wCab = tr.dataset.cab; D().setTab('wiring'); }
    };
  }
  function diagram(s, onBatt, off) {
    var c = function (on) { return on ? 'var(--good)' : 'var(--line)'; };
    var gridOn = s.grid, genOn = s.genOn && !s.grid, feed = gridOn || genOn;
    var box = function (x, y, w, t, sub, on, warn) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="40" rx="6" fill="var(--panel-2)" stroke="' + (warn ? 'var(--bad)' : on ? 'var(--good)' : 'var(--line)') + '" stroke-width="2"/>' +
        '<text x="' + (x + w / 2) + '" y="' + (y + 17) + '" text-anchor="middle" font-size="12" font-weight="700" fill="var(--fg)">' + t + '</text>' +
        '<text x="' + (x + w / 2) + '" y="' + (y + 32) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + sub + '</text>';
    };
    var ln = function (x1, y1, x2, y2, on) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + c(on) + '" stroke-width="3"/>'; };
    return '<div class="tw"><svg viewBox="0 0 440 300" width="100%" style="max-width:440px" role="img" aria-label="Однолінійна схема живлення">' +
      ln(70, 50, 70, 80, gridOn) + ln(370, 50, 370, 80, genOn || s.phase === 'test') + ln(70, 80, 190, 80, gridOn) + ln(370, 80, 250, 80, genOn) +
      ln(220, 100, 220, 130, feed) + ln(220, 170, 75, 190, feed) + ln(220, 170, 220, 190, feed) + ln(220, 170, 365, 190, gridOn) +
      ln(75, 230, 75, 250, true) + ln(140, 210, 160, 270, true) +
      box(10, 10, 120, 'Мережа 0,4 кВ', gridOn ? 'є напруга' : 'НЕМАЄ', gridOn, !gridOn) +
      box(310, 10, 120, 'ДГУ 60 кВА', esc(s.gen), genOn || s.phase === 'test', s.genFault || (s.genFail && !s.grid)) +
      box(160, 60, 120, 'АВР', s.atsFault ? 'НЕСПРАВНИЙ' : gridOn ? 'введення 1' : genOn ? 'введення 2' : 'очікування', feed, s.atsFault) +
      box(160, 130, 120, 'ГРЩ А-003', 'розподіл I / II / III', feed) +
      box(10, 190, 130, 'I · ДБЖ 20 кВА', s.upsCFault ? 'АКБ несправні' : Math.round(s.upsC) + ' %' + (s.serverDown ? ' · сервер вимк.' : ''), true, s.upsCFault || s.upsC < 25) +
      box(160, 190, 120, 'II — важливі', feed ? 'ДГУ / мережа' : 'без живлення', feed) +
      box(300, 190, 130, 'III — відключувані', gridOn ? 'мережа' : 'вимкнено', gridOn, !gridOn) +
      box(10, 250, 130, 'Сервер · ядро', s.serverDown ? 'вимкнено' : 'онлайн', !s.serverDown, s.serverDown) +
      box(160, 250, 270, 'Шафи ЩА × ' + DEV.cabinets.length + ' (власні ДБЖ)', off ? off + ' знеструмлено' : onBatt ? onBatt + ' на батареї' : 'усі від вводу', !off, !!off) +
      '</svg></div>';
  }

  /* =================== КОМУТАЦІЯ =================== */
  /* Траса кабелю (схематично): пристрій → РК приміщення → вихід у коридор → лоток коридору → шафа */
  function route(d, l, k) {
    var cab = DEV.cabinet(d.cabinet); if (!cab) return [];
    var dz = (k || 0) * 0.25;
    var tray = cab.territory ? 0.4 : B.floorZ(cab.block, cab.floor) + B.floorH - 0.35 - dz;
    var pts = [{ x: d.x, y: d.y, z: d.z }], s;
    if (d.room && W.jbox(d.room)) {
      var jb = W.jbox(d.room), dr = jb.door;
      pts.push({ x: d.x, y: d.y, z: jb.z - dz }, { x: jb.x, y: d.y, z: jb.z - dz }, { x: jb.x, y: jb.y, z: jb.z - dz });
      s = dr.nx ? { x: dr.x + dr.nx * 1.3, y: jb.y } : { x: jb.x, y: dr.y + (dr.ny || 0) * 1.3 };
      pts.push({ x: s.x, y: s.y, z: tray });
    } else { s = { x: d.x, y: d.y }; pts.push({ x: d.x, y: d.y, z: tray }); }
    if (d.block === 'A' && !cab.territory) pts.push({ x: -24.5, y: s.y, z: tray }, { x: -24.5, y: cab.y, z: tray });
    else if (d.block === 'B' && !cab.territory) pts.push({ x: s.x, y: 10.5, z: tray }, { x: cab.x, y: 10.5, z: tray });
    else pts.push({ x: cab.x, y: s.y, z: tray });
    pts.push({ x: cab.x, y: cab.y, z: tray }, { x: cab.x, y: cab.y, z: cab.z });
    return pts;
  }
  function cabMarker(cab) {
    return DEV.devices.filter(function (x) { return x.kind === 'cabinet' && x.label === cab.id; })[0];
  }
  /* Фокус на одному пристрої або на всіх лініях контролера */
  function applyFocus() {
    var V = D().viewer, f = st.focus;
    if (!f) { V.setFocus(null); return; }
    var links = f.type === 'dev' ? DEV.device(f.id).conn.filter(function (l) { return l.type !== 'WIFI'; })
      : W.instances(st.wCab).filter(function (i) { return i.id === f.id; })[0].ports;
    var cab = DEV.cabinet(st.wCab), devs = [], rooms = {}, paths = [], marks = [];
    var cm = cabMarker(cab); if (cm) devs.push(cm);
    links.forEach(function (l, k) {
      var d = l.device; if (devs.indexOf(d) < 0) devs.push(d);
      if (d.room) rooms[d.room] = 1;
      if (l.type !== 'UP') paths.push({ pts: route(d, l, f.type === 'dev' ? k : 0), color: W.BUS[l.type].color, width: f.type === 'dev' ? 0.16 : 0.09 });
    });
    if (f.type === 'dev') {
      var d0 = DEV.device(f.id), jb = d0.room ? W.jbox(d0.room) : null;
      marks.push({ x: d0.x, y: d0.y, z: d0.z + 0.6, text: DEV.KINDS[d0.kind].icon + ' ' + (d0.room || d0.label || d0.id), w: 4, dy: 2.4 });
      if (jb) marks.push({ x: jb.x, y: jb.y, z: jb.z, text: '📦 ' + jb.id, w: 3.6, dy: 1.0 });
      marks.push({ x: cab.x, y: cab.y, z: cab.z + 1, text: '⚡ ' + cab.id + ' · ' + links.filter(function (l) { return l.inst; }).map(function (l) { return l.inst.short + ' ' + l.port; }).join(', '), w: 6, dy: 2.2 });
    } else marks.push({ x: cab.x, y: cab.y, z: cab.z + 1, text: '⚡ ' + f.id + ' · ' + links.length + ' ліній', w: 6, dy: 2.2 });
      Object.keys(rooms).forEach(function (rid) { var rr = B.room(rid); marks.push({ x: (rr.x0 + rr.x1) / 2, y: (rr.y0 + rr.y1) / 2, z: rr.z0 + rr.h, text: rid, w: 3, dy: 0.6 }); });
    D().setDevCats(null);
    if (!cab.territory) D().setFloorBtn(cab.floor);
    V.setFocus({ devices: devs, rooms: Object.keys(rooms), paths: paths, marks: marks, floor: cab.territory ? null : cab.floor });
  }
  /* Виділення пристрою: траса на карті + та сама плаваюча картка пристрою, що й при кліку на карті */
  function focusDevice(d, back) {
    D().forgetDetails('tab:wiring');
    if (!d) return;
    if (d.cabinet && d.cabinet !== st.wCab) st.wCab = d.cabinet;
    st.focus = { type: 'dev', id: d.id };
    D().renderPanel(); applyFocus();
    D().openDevice(d, back);
    var c = document.getElementById('wFocus'); if (c) c.scrollIntoView({ block: 'nearest' });
  }
  function focusInst(id) { D().forgetDetails('tab:wiring'); st.focus = { type: 'inst', id: id }; D().renderPanel(); applyFocus(); }
  function clearFocus() { var dev = st.focus && st.focus.type === 'dev'; st.focus = null; D().renderPanel(); D().viewer.setFocus(null); if (dev) D().openDevice(null); }

  var PORT_TXT = { ok: 'норма', fault: 'несправність пристрою', alarm: 'тривога', off: 'без живлення / контролер offline', stale: 'немає зв’язку шафи', manual: 'вимкнено вручну' };
  function simBtn(act, label, on, title) {
    return '<button class="btn small' + (on ? ' danger on' : '') + '" data-sim="' + act + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (on ? '✕ ' : '') + esc(label) + '</button>';
  }

  function focusCard() {
    var f = st.focus; if (!f) return '<div class="note">Натисніть порт у схемі шафи, рядок таблиці чи маркер на карті — на плані залишиться лише цей елемент, його приміщення і траса кабелю. ' +
      'Картка пристрою відкриється поверх карти — там стан, підключення, кнопка ручного вимкнення та імітація несправностей.</div>';
    var n = D().now(), h = '<div class="card focus-card" id="wFocus"><div class="row"><b class="grow">Виділено</b><button class="btn small" data-wf="clear">✕ Показати все</button></div>';
    if (f.type === 'dev') {     // подробиці — у єдиній плаваючій картці пристрою на карті
      var d = DEV.device(f.id), s = DS.state(d, n), inst0 = d.conn[0] && d.conn[0].inst;
      return '<div class="focus-bar" id="wFocus"><span class="small muted">Виділено</span><b>' + DEV.KINDS[d.kind].icon + ' ' + esc(d.label || d.name) + '</b>' +
        '<span class="lvl ' + DS.STATUS[s.status].lvl + ' small">' + DS.STATUS[s.status].name + '</span><span class="grow"></span>' +
        '<button class="btn small" data-wf="card" title="Відкрити картку пристрою">Картка</button>' +
        (inst0 ? '<button class="btn small" data-wf="inst" data-inst="' + esc(inst0.id) + '" title="Усі лінії цього контролера">Усі лінії ' + esc(inst0.short) + '</button>' : '') +
        '<button class="btn small" data-wf="clear">✕ Показати все</button></div>';
    } else {
      var i = W.instances(st.wCab).filter(function (x) { return x.id === f.id; })[0], rooms = {}, cs = FL.ctrlState(i, n);
      i.ports.forEach(function (l) { if (l.device.room) rooms[l.device.room] = 1; });
      h += '<div style="font-size:16px;font-weight:700;margin-top:4px">' + esc(i.id) + '</div><div class="small muted">' + esc(i.model) + ' · ' + i.ports.length + ' ліній · приміщень: ' + Object.keys(rooms).length + '</div>' +
        '<div class="small">Стан: <span class="lvl ' + (cs.status === 'ok' ? 'good' : cs.status === 'warn' ? 'warn' : 'bad') + '">' + esc(cs.text) + '</span></div>' +
        '<div class="small">' + Object.keys(W.POOLS[i.model].ports).map(function (t) { return esc(W.BUS[t].name) + ': ' + (i.used[t] || 0) + ' / ' + W.POOLS[i.model].ports[t]; }).join(' · ') + '</div>' +
        '<div class="sim-row"><b class="small">Імітація:</b>' + simBtn('ctrl:' + i.id, FL.ctrlDown(i.id) ? 'Контролер offline' : 'Відмова контролера', FL.ctrlDown(i.id)) + '</div>' +
        '<div class="small muted" style="margin-top:4px">Натисніть порт або рядок нижче, щоб виділити одну лінію.</div>';
    }
    return h + '</div>';
  }

  /* Обробка кнопок імітації (data-sim) — спільна для картки й панелі шафи */
  function runSim(act) {
    var f = st.focus, d = f && f.type === 'dev' ? DEV.device(f.id) : null;
    if (act === 'dev' && d) FL.toggleDevice(d);
    if (act === 'trig' && d) { FL.trigger(d); U.toast('Подію згенеровано — див. «Безпека → Сповіщення»', 'warn'); }
    if (act.indexOf('ctrl:') === 0) FL.toggleCtrl(W.instances(st.wCab).filter(function (i) { return i.id === act.slice(5); })[0]);
    if (act === 'feed') FL.toggleCabFeed(st.wCab);
    if (act === 'ups') FL.toggleCabUps(st.wCab);
    if (act === 'link') FL.toggleCabLink(st.wCab);
    if (act === 'reset') FL.resetCab(st.wCab);
    if (act === 'resetAll') FL.resetAll();
    if (st.focus) applyFocus();
  }

  function wiring(p) {
    var cab = DEV.cabinet(D().ui.wCab || st.wCab || 'ЩА-А2') || DEV.cabinets[0];
    if (D().ui.wCab && D().ui.wCab !== st.wCab) st.focus = null;
    st.wCab = cab.id; D().ui.wCab = null;
    if (st.focus && st.focus.type === 'dev' && DEV.device(st.focus.id).cabinet !== cab.id) st.focus = null;
    var n = D().now(), links = W.forCabinet(cab.id), insts = W.instances(cab.id), f = st.focus;
    var selDev = f && f.type === 'dev' ? f.id : null, selInst = f && f.type === 'inst' ? f.id : null;
    var cs = PW.cabState(cab.id, n), sum = FL.summary(n);
    var portCnt = { fault: 0, alarm: 0, off: 0, stale: 0, manual: 0 };
    links.forEach(function (l) { if (l.inst) { var ps = FL.portState(l, n); if (portCnt[ps] != null) portCnt[ps]++; } });

    var h = '<h2>Карта комутації</h2><div class="muted small">Кількість портів умовна — звірити з документацією i3 Engineering. Довжини — оцінка.</div>';
    h += '<div class="row" style="margin:8px 0">' + D().sel('wCab', DEV.cabinets.map(function (c) {
      var x = PW.cabState(c.id, n), bad = !x.online || !x.uplink ? ' ⛔' : !x.feedOk || x.upsFault ? ' ⚠' : '';
      return [c.id, c.id + ' · ' + (c.territory ? 'територія' : B.blockById(c.block).name + ', поверх ' + c.floor) + bad]; }), cab.id) +
      '<button class="btn small" id="wShow" title="Усі лінії шафи на плані">Усі лінії шафи</button><button class="btn small" id="wHide">Очистити план</button>' +
      '<button class="btn small" id="wDoc" title="Опис усіх елементів і їх комутації у форматі Word">📄 .docx</button></div>';

    /* Стан шафи та імітації рівня шафи */
    var cl = !cs.online ? 'bad' : !cs.feedOk || cs.upsFault || !cs.uplink ? 'warn' : 'good';
    h += '<div class="cab-status ' + cl + '"><div class="row"><b class="grow">Шафа ' + esc(cab.id) + '</b>' +
      '<span class="small">Ввід: ' + (cs.feedOk ? esc(cs.src) : '<b>немає</b>') + ' · ДБЖ: ' + (cs.upsFault ? '<b>АКБ несправні</b>' : cs.batt + ' %' + (!cs.feedOk && cs.online ? ' (~' + cs.leftMin + ' хв)' : '')) +
      ' · Зв’язок: ' + (cs.uplink ? 'норма' : '<b>обрив</b>') + '</span></div>' +
      '<div class="small" style="margin-top:2px">Порти: ' + (portCnt.fault + portCnt.alarm + portCnt.off + portCnt.stale ? [
        portCnt.fault ? '<span class="pdot p-fault"></span>' + portCnt.fault + ' несправн.' : '', portCnt.alarm ? '<span class="pdot p-alarm"></span>' + portCnt.alarm + ' тривога' : '',
        portCnt.off ? '<span class="pdot p-off"></span>' + portCnt.off + ' offline' : '', portCnt.stale ? '<span class="pdot p-stale"></span>' + portCnt.stale + ' без зв’язку' : ''].filter(Boolean).join(' · ') : 'усі в нормі') + '</div>' +
      '<div class="sim-row"><b class="small">Імітація шафи:</b>' + simBtn('feed', cs.sim.feedLost ? 'Немає вводу' : 'Обрив вводу живлення', cs.sim.feedLost, 'Шафа переходить на власний ДБЖ (~6 год)') +
      simBtn('ups', cs.upsFault ? 'АКБ несправні' : 'Несправність АКБ', cs.upsFault, 'Без резерву: при обриві вводу шафа одразу знеструмиться') +
      simBtn('link', !cs.uplink ? 'Обрив зв’язку' : 'Обрив зв’язку із серверною', !cs.uplink, 'Контролери працюють локально, дані не надходять') +
      '<button class="btn small" data-sim="reset">↺ Скинути шафу</button>' + (sum.any ? '<button class="btn small" data-sim="resetAll">↺ Скинути всі імітації</button>' : '') + '</div></div>';

    h += focusCard();

    var feed = W.feeds.filter(function (x) { return x.cabinet === cab.id; })[0];
    h += '<h3>Шафа ' + esc(cab.id) + ' — компонування</h3><div class="small muted" style="margin-bottom:4px">≈ ' + cab.units + ' модулів DIN · живлення: ' +
      esc(feed.from) + ', ' + esc(feed.cable) + ' ≈ ' + feed.len + ' м. Клік по порту — виділити лінію; по назві модуля — усі його лінії; по ДБЖ/вводу/аплінку — імітація.</div>' + cabinetSvg(cab, selDev, selInst, n);
    h += '<div class="legend-map" style="margin:4px 0 2px">' + ['fault', 'alarm', 'off', 'stale', 'manual'].map(function (k) { return '<span class="k"><span class="pdot p-' + k + '"></span>' + PORT_TXT[k] + '</span>'; }).join('') + '</div>';
    h += '<div class="legend-map" style="margin:2px 0 8px">' + Object.keys(W.BUS).filter(function (k) { return links.some(function (l) { return l.type === k; }); }).map(function (k) {
      return '<span class="k"><i style="background:' + W.BUS[k].css + '"></i>' + esc(W.BUS[k].name) + '</span>';
    }).join('') + '</div>';

    insts.forEach(function (i) {
      var pool = W.POOLS[i.model], open = selInst === i.id || i.ports.some(function (l) { return l.device.id === selDev; }), ics = FL.ctrlState(i, n);
      h += '<details class="inst' + (selInst === i.id ? ' sel' : '') + (ics.status !== 'ok' ? ' ' + ics.status : '') + '"' + (open ? ' open' : '') + '><summary><b>' + esc(i.short) + '</b> · ' + esc(i.model) +
        (ics.status !== 'ok' ? ' <span class="lvl ' + (ics.status === 'warn' ? 'warn' : 'bad') + ' small">' + esc(ics.text) + '</span>' : '') +
        ' <span class="muted small">' + Object.keys(pool.ports).map(function (t) { return t + ' ' + (i.used[t] || 0) + '/' + pool.ports[t]; }).join(' · ') + '</span>' +
        '<button class="btn small" data-wf="inst" data-inst="' + esc(i.id) + '">Виділити всі</button></summary>' +
        '<div class="tw"><table class="t"><tbody>' + i.ports.map(function (l) {
          var ps = FL.portState(l, n);
          return '<tr class="click' + (l.device.id === selDev ? ' sel' : '') + '" data-wdev="' + esc(l.device.id) + '"><td class="small"><span class="pdot p-' + ps + '" title="' + PORT_TXT[ps] + '"></span>' +
            '<span class="cat-dot" style="background:' + W.BUS[l.type].css + '"></span>' + esc(l.port) + '</td>' +
            '<td class="small">' + DEV.KINDS[l.device.kind].icon + ' ' + esc(l.device.name) + '</td><td class="small">' + esc(l.device.room || l.device.label || l.device.zone || '') + '</td>' +
            '<td class="small">' + esc(l.cable) + '<br><span class="muted">≈ ' + l.len + ' м</span></td></tr>';
        }).join('') + '</tbody></table></div></details>';
    });
    var wl = links.filter(function (l) { return !l.inst; });
    if (wl.length) h += '<h3>Без порту контролера</h3><div class="small">' + wl.map(function (l) { return esc(l.device.name) + ' — ' + esc(W.BUS[l.type].name) + (l.len ? ' · ' + esc(l.cable) + ' ≈ ' + l.len + ' м' : ''); }).join('<br>') + '</div>';

    h += '<h3>Топологія мережі й живлення</h3>' + topology(cab.id);
    var cb = {}; links.forEach(function (l) { if (l.cable !== '—') cb[l.cable] = (cb[l.cable] || 0) + l.len; });
    var all = W.cables();
    h += '<h3>Кабельний журнал</h3><table class="t"><thead><tr><th>Кабель</th><th>Шафа ' + esc(cab.id) + '</th><th>Корпус</th></tr></thead><tbody>' + Object.keys(all).map(function (k) {
      return '<tr><td class="small">' + esc(k) + '</td><td>' + (cb[k] ? '≈ ' + cb[k] + ' м' : '—') + '</td><td>≈ ' + all[k] + ' м</td></tr>';
    }).join('') + '</tbody></table><div class="small muted">Траса «по осях» + 3 м запасу; при проєктуванні додати 10–15 % на лотки й опуски.</div>';
    p.innerHTML = h;
    $('#wCab', p).onchange = function (e) { st.wCab = e.target.value; st.focus = null; D().viewer.setFocus(null); D().renderPanel(); show(); };
    p.onclick = function (e) {
      var pw = e.target.closest('[data-pwr]');
      if (pw) { e.preventDefault(); toastCmd(CT.toggle(DEV.device(pw.dataset.pwr))); if (st.focus) applyFocus(); return; }
      var sb = e.target.closest('[data-sim]');
      if (sb) { e.preventDefault(); runSim(sb.dataset.sim); return; }
      var b = e.target.closest('button');
      if (b) {
        e.preventDefault();
        if (b.id === 'wShow') { st.focus = null; D().viewer.setFocus(null); D().renderPanel(); show(); }
        if (b.id === 'wHide') { st.focus = null; D().viewer.setFocus(null); D().viewer.setWiring(null); D().setDevCats(null); D().renderPanel(); }
        if (b.id === 'wDoc') { SK.wiringDoc.download(); U.toast('Документ сформовано', 'good'); }
        if (b.dataset.wf === 'clear') clearFocus();
        if (b.dataset.wf === 'card' && st.focus) D().openDevice(DEV.device(st.focus.id));
        if (b.dataset.wf === 'card' && st.focus) D().openDevice(DEV.device(st.focus.id));
        if (b.dataset.wf === 'inst') focusInst(b.dataset.inst);
        if (b.dataset.wf === 'room') SK.RoomView.open(DEV.device(st.focus.id).room);
        return;
      }
      var port = e.target.closest('[data-dev]');            // клітинка порту в SVG
      if (port) { focusDevice(DEV.device(port.dataset.dev)); return; }
      var mod = e.target.closest('[data-inst]');            // модуль у SVG
      if (mod) { focusInst(mod.dataset.inst); return; }
      var tr = e.target.closest('[data-wdev]');
      if (tr) focusDevice(DEV.device(tr.dataset.wdev));
    };
    function show() {
      var c = DEV.cabinet(st.wCab), ls = W.forCabinet(c.id).filter(function (l) { return l.type !== 'WIFI' && l.type !== 'UP'; });
      D().viewer.setFocus(null);
      D().viewer.setWiring(ls.map(function (l) { return { a: l.device, b: c, color: W.BUS[l.type].color }; }));
      var cats = {}; ls.forEach(function (l) { cats[l.device.cat] = 1; });
      D().setDevCats(Object.keys(cats));
      if (!c.territory) { D().setFloorBtn(c.floor); D().viewer.setFloor(c.floor, true); }
      D().viewer.focusDevice({ block: c.territory ? 'T' : c.block, floor: c.floor, x: c.x, y: c.y + 20, z: c.z });
    }
    if (f && !D().viewer.hasFocus()) setTimeout(applyFocus, 30);
  }

  /* Схема шафи: DIN-рейки з модулями. Кожен порт — клітинка кольору шини; несправність, тривога,
     відсутність живлення чи зв'язку показуються прямо в клітинці порту й на рамці модуля. */
  function cabinetSvg(cab, selDev, selInst, n) {
    var anySel = !!(selDev || selInst), cs = PW.cabState(cab.id, n);
    var insts = W.instances(cab.id), Wd = 470, y = 10, rows = [], row = [], rowU = 0, MAXU = 18;
    insts.forEach(function (i) { var u = W.POOLS[i.model].u; if (rowU + u > MAXU) { rows.push(row); row = []; rowU = 0; } row.push(i); rowU += u; });
    if (row.length) rows.push(row);
    rows.unshift([
      { fixed: 'ДБЖ 24 В', u: 4, sim: 'ups', sub: cs.upsFault ? 'АКБ ✕' : cs.batt + ' %' + (!cs.feedOk && cs.online ? ' · ' + cs.leftMin + ' хв' : ''), st: cs.upsFault || !cs.online ? 'bad' : !cs.feedOk ? 'warn' : 'good' },
      { fixed: 'Ввід / автомати', u: 5, sim: 'feed', sub: cs.feedOk ? 'напруга: ' + cs.src : 'немає напруги', st: cs.feedOk ? 'good' : 'bad' },
      { fixed: 'Аплінк', u: 3, sim: 'link', sub: cs.uplink ? 'зв’язок є' : 'обрив', st: cs.uplink ? 'good' : 'bad' }]);
    var unit = (Wd - 20) / MAXU, s = '';
    rows.forEach(function (rw, ri) {
      var x = 10;
      s += '<rect x="6" y="' + (y + 34) + '" width="' + (Wd - 12) + '" height="4" fill="var(--line)"/>';     // DIN-рейка
      rw.forEach(function (i) {
        var u = i.fixed ? i.u : W.POOLS[i.model].u, w = u * unit - 4;
        if (i.fixed) {
          var col = 'var(--' + i.st + ')';
          s += '<g class="module fixed" data-sim="' + i.sim + '" style="cursor:pointer"><title>' + esc(i.fixed + ': ' + i.sub + ' — клік для імітації') + '</title>' +
            '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="56" rx="4" fill="var(--panel-2)" stroke="' + col + '" stroke-width="2"/>' +
            '<circle cx="' + (x + w - 10) + '" cy="' + (y + 10) + '" r="5" fill="' + col + '"' + (i.st === 'bad' ? ' class="blink"' : '') + '/>' +
            '<text x="' + (x + 5) + '" y="' + (y + 15) + '" font-size="10" font-weight="700" fill="var(--fg)">' + esc(i.fixed) + '</text>' +
            '<text x="' + (x + 5) + '" y="' + (y + 31) + '" font-size="9" fill="' + col + '">' + esc(i.sub) + '</text></g>';
          x += u * unit; return;
        }
        var cst = FL.ctrlState(i, n), on = selInst === i.id || i.ports.some(function (l) { return l.device.id === selDev; });
        var stroke = on ? 'var(--accent)' : cst.status === 'offline' ? 'var(--bad)' : cst.status === 'warn' ? 'var(--warn)' : 'var(--line)';
        s += '<g class="module" data-inst="' + esc(i.id) + '" style="cursor:pointer"><title>' + esc(i.id + ' · ' + i.model + ' · ' + cst.text) + '</title>' +
          '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="72" rx="4" fill="var(--panel-2)" stroke="' + stroke + '" stroke-width="' + (on || cst.status !== 'ok' ? 2.5 : 1) + '"' + (anySel && !on ? ' opacity=".5"' : '') + '/>' +
          '<text x="' + (x + 4) + '" y="' + (y + 13) + '" font-size="10" font-weight="700" fill="var(--fg)">' + esc(i.short) + '</text>' +
          (cst.status === 'offline' ? '<text x="' + (x + w - 4) + '" y="' + (y + 13) + '" text-anchor="end" font-size="9" font-weight="700" fill="var(--bad)">OFFLINE</text>' :
            cst.status === 'warn' ? '<text x="' + (x + w - 4) + '" y="' + (y + 13) + '" text-anchor="end" font-size="9" font-weight="700" fill="var(--warn)">⚠</text>' : '') + '</g>';
        s += '<text x="' + (x + 4) + '" y="' + (y + 25) + '" font-size="8" fill="var(--muted)">' + esc(i.model.replace('Atom ', '').slice(0, Math.max(6, Math.floor(w / 5)))) + '</text>';
        var cells = [];
        Object.keys(W.POOLS[i.model].ports).forEach(function (t) { for (var k = 0; k < W.POOLS[i.model].ports[t]; k++) cells.push({ t: t, k: k }); });
        var step = 9, per = Math.max(1, Math.floor((w - 6) / step));
        if (Math.ceil(cells.length / per) * step > 38) { step = 7; per = Math.max(1, Math.floor((w - 6) / step)); }
        var cw = step - 1;
        cells.forEach(function (c, k) {
          var cx = x + 3 + (k % per) * step, cy = y + 30 + Math.floor(k / per) * step;
          if (cy > y + 66) return;
          var l = i.ports.filter(function (pp) { return pp.type === c.t; })[c.k];
          var ps = l ? FL.portState(l, n) : 'free', hit = l && (l.device.id === selDev || selInst === i.id);
          var fill = !l || ps === 'manual' ? 'var(--panel)' : ps === 'off' ? 'var(--na)' : W.BUS[c.t].css;
          s += '<rect class="port p-' + ps + (hit ? ' hit' : '') + '" x="' + cx + '" y="' + cy + '" width="' + cw + '" height="' + cw + '" rx="1" fill="' + fill + '"' +
            ' stroke="' + (ps === 'fault' || ps === 'alarm' ? 'var(--bad)' : hit ? 'var(--fg)' : 'var(--line)') + '" stroke-width="' + (ps === 'fault' || ps === 'alarm' || hit ? 1.6 : 1) + '"' +
            (anySel && l && !hit && ps === 'ok' ? ' opacity=".3"' : ps === 'stale' ? ' opacity=".45"' : '') +
            (l ? ' data-dev="' + esc(l.device.id) + '"><title>' + esc(c.t + ' ' + (c.k + 1) + ' → ' + l.device.name + ' · ' + (l.device.room || l.device.label || '') + ' · ' + PORT_TXT[ps]) + '</title></rect>'
              : '><title>' + esc(c.t + ' ' + (c.k + 1) + ' — вільний') + '</title></rect>');
          if (ps === 'fault' || ps === 'off') s += '<path d="M' + (cx + 1) + ' ' + (cy + 1) + 'l' + (cw - 2) + ' ' + (cw - 2) + 'M' + (cx + cw - 1) + ' ' + (cy + 1) + 'l-' + (cw - 2) + ' ' + (cw - 2) + '" stroke="' + (ps === 'fault' ? '#fff' : 'var(--bad)') + '" stroke-width="1.2" pointer-events="none"/>';
        });
        x += u * unit;
      });
      y += ri === 0 ? 66 : 82;
    });
    return '<div class="tw"><svg class="cabinet-svg" viewBox="0 0 ' + Wd + ' ' + (y + 4) + '" width="100%" style="max-width:' + Wd + 'px" role="img" aria-label="Компонування шафи">' + s + '</svg></div>';
  }
  function topology(sel) {
    var cols = { A: 60, C: 200, B: 300, T: 400 }, W0 = 470, H0 = 264;
    var y = function (f) { return 200 - f * 38; };
    var adm = { x: 180, y: 232 };
    var s = '<div class="tw"><svg viewBox="0 0 ' + W0 + ' ' + H0 + '" width="100%" style="max-width:470px" role="img" aria-label="Топологія мережі">';
    DEV.cabinets.forEach(function (c) {
      var cx = cols[c.territory ? 'T' : c.block], cy = c.territory ? 200 : y(c.floor);
      s += '<line x1="' + cx + '" y1="' + (cy + 12) + '" x2="' + adm.x + '" y2="' + (adm.y - 12) + '" stroke="var(--line)" stroke-width="1.5"/>';
      s += '<line x1="' + (cx + 20) + '" y1="' + (cy + 12) + '" x2="420" y2="' + (adm.y - 12) + '" stroke="#d49a00" stroke-width="1" stroke-dasharray="4 3" opacity=".7"/>';
    });
    DEV.cabinets.forEach(function (c) {
      var cx = cols[c.territory ? 'T' : c.block], cy = c.territory ? 200 : y(c.floor), on = c.id === sel;
      s += '<rect x="' + (cx - 34) + '" y="' + (cy - 12) + '" width="68" height="24" rx="5" fill="' + (on ? 'var(--accent)' : 'var(--panel-2)') + '" stroke="var(--line)"/>' +
        '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + (on ? 'var(--accent-fg)' : 'var(--fg)') + '">' + esc(c.id) + '</text>';
    });
    s += '<rect x="372" y="' + (adm.y - 12) + '" width="96" height="24" rx="5" fill="#d49a00"/><text x="420" y="' + (adm.y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#1b2830">ГРЩ А-003</text>';
    s += '<rect x="' + (adm.x - 135) + '" y="' + (adm.y - 12) + '" width="270" height="24" rx="5" fill="#1f4e79" stroke="#1f4e79"/>' +
      '<text x="' + adm.x + '" y="' + (adm.y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">Серверна А-002 · ядро мережі · MQTT</text>';
    ['А', 'Перемичка', 'Б', 'Територія'].forEach(function (t, i) {
      s += '<text x="' + [60, 200, 300, 400][i] + '" y="14" text-anchor="middle" font-size="11" fill="var(--muted)">' + t + '</text>';
    });
    s += '<text x="10" y="260" font-size="10" fill="var(--muted)">— мережа (до серверної)   - - живлення від ГРЩ через ДБЖ</text>';
    return s + '</svg></div>';
  }

  return { events: events, scenarios: scenarios, access: access, power: power, wiring: wiring, control: control, setCtlRoom: setCtlRoom, toastCmd: toastCmd, focusDevice: focusDevice, focusInst: focusInst,
    PORT_TXT: PORT_TXT, devFocused: function () { return !!(st.focus && st.focus.type === 'dev'); },
    refocus: function () { if (st.focus) applyFocus(); },
    clearFocus: function () { st.focus = null; } };
})();
