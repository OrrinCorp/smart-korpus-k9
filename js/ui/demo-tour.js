/* Демонстраційний сценарій для захисту (ТЗ п. 3 та 7): покроковий тур по панелі адміністрування. */
SK.tour = (function () {
  var U = SK.util, D = SK.dashboard, store = SK.store, $ = U.$;
  var i = 0, saved = null;

  function firstRoom(pred) {
    var n = store.clock.now();
    return SK.building.bookableRooms().filter(function (r) { return pred(r, SK.schedule.status(r.id, n), SK.i3.read(r.id, n)); })[0];
  }
  function role(r) { store.state.role = r; $('#role').value = r; store.save(); }
  function floorBtn(f) { U.$all('#floors button').forEach(function (b) { b.classList.toggle('on', b.dataset.f === String(f)); }); }
  function floor(f) { floorBtn(f === null ? '' : f); D.viewer.setFloor(f); }

  var STEPS = [
    { title: '1. Цифрова модель корпусу', text: 'Блоки А і Б по 5 поверхів: нульовий — хол і службові приміщення (темно-синім — адміністративне приміщення-диспетчерська, фіолетовим — серверна), 1–4 — аудиторії. Перемичка — на рівні 1-го поверху.',
      run: function () { D.setSimTime(1, '09:55'); D.setTab('overview'); D.setColorMode('status'); D.setDevCats(null); D.viewer.setWiring(null); floor(null); D.viewer.home(); } },
    { title: '2. Нульовий поверх і адмін. приміщення', text: 'Поверх 0: вестибюль, пост охорони, адміністративне приміщення з робочим місцем диспетчера, серверна з центральним ДБЖ та електрощитова з АВР.',
      run: function () { floor(0); var a = SK.building.adminRoom(); D.viewer.select(a.id); D.viewer.focusRoom(a.id); } },
    { title: '3. Розклад і статуси', text: 'Понеділок, 2-га пара, 2-й поверх: вільні (зелені), зайняті (червоні), заброньовані чи зайняті подією (сині) аудиторії.',
      run: function () { D.setTab('rooms'); floor(2); var r = firstRoom(function (r, s) { return r.floor === 2 && s.status === 'busy'; }); if (r) { D.viewer.select(r.id); D.viewer.focusRoom(r.id); } } },
    { title: '4. Адміністрування сценаріїв', text: 'Правила з пріоритетами: відключення живлення → ручний режим → за часом → за розкладом → присутність → нічний режим → автовимкнення. Колір на карті — активний сценарій.',
      run: function () { role('admin'); D.setTab('scenarios'); D.setColorMode('scenario'); floor(null); D.viewer.home(); } },
    { title: '5. Ручний сценарій «Презентація»', text: 'Відповідальна особа вмикає «Презентацію» для лекційної аудиторії на 90 хв: світло 30 %, жалюзі закриті, проєктор і онлайн-дошка увімкнені.',
      run: function () {
        var r = firstRoom(function (r, s) { return r.type === 'lecture' && s.status === 'busy'; });
        if (r) { SK.scenarios.apply([r.id], 'presentation', 90); floor(r.floor); D.viewer.select(r.id); D.viewer.focusRoom(r.id); }
      } },
    { title: '6. Автовимкнення', text: 'Перерва після 2-ї пари: через 10 хв без руху порожні аудиторії переходять у сценарій «Немає людей» — світло, проєктори й ПК вимикаються.',
      run: function () { D.setSimTime(1, '11:25'); D.setColorMode('light'); D.setTab('comfort'); floor(null); D.viewer.home(); } },
    { title: '7. Розумні пристрої та комутація', text: 'Вкладка «Комутація»: натискання на порт, рядок чи маркер виділяє лише цей пристрій, його приміщення й трасу кабелю (пристрій → розподільча коробка → лоток коридору → шафа ЩА), решта індикаторів ховається.',
      run: function () {
        D.ui.wCab = 'ЩА-А2'; D.setTab('wiring');
        var d = SK.devicesI3.devices.filter(function (x) { return x.kind === 'finger' && x.cabinet === 'ЩА-А2'; })[0];
        if (d) SK.adminTabs.focusDevice(d);
      } },
    { title: '7б. Несправності прямо в схемі комутації', text: 'Шафа ЩА-А2: обрив вводу (шафа на власному ДБЖ), відмова контролера HY1 (усі його порти offline), несправний датчик CO₂ (червоний порт з хрестиком), протікання (порт блимає). Кожну несправність можна ввімкнути й усунути кнопками «Імітація» прямо в схемі.',
      run: function () { SK.tourFaults = true; var d = SK.faults.demo('ЩА-А2'); D.ui.wCab = 'ЩА-А2'; D.setTab('wiring'); if (d) SK.adminTabs.focusDevice(d); } },
    { title: '8. Доступ за відбитком пальця', text: 'Викладач прикладає палець до зчитувача кабінету — доступ дозволено; невідомий відбиток — відмова й подія в журналі. Шаблони відбитків зберігаються лише на сервері доступу.',
      run: function () {
        SK.faults.resetAll(); D.viewer.setFocus(null); D.viewer.setWiring(null); D.setTab('access');
        var door = SK.security.doors.filter(function (d) { return d.zone === 'office'; })[0];
        var t = SK.security.users().filter(function (u) { return u.group === 'teachers' && u.prints; })[0];
        SK.security.attempt(t.id, door.id); SK.security.attempt(null, door.id);
      } },
    { title: '8б. Диспетчерська А-001', text: 'Оператор вимикає світло в порожній аудиторії кнопкою ⏻ і відчиняє двері кабінету на 5 с. Кожна команда йде шляхом сервер → MQTT → шафа → контролер і пишеться в журнал команд; через знеструмлену шафу команда «не доставлена».',
      run: function () { role('admin'); D.setTab('control'); var r = SK.building.room('А-205'); SK.adminTabs.setCtlRoom(r.id); var l = SK.devicesI3.roomDevices(r).filter(function (x) { return x.kind === 'light'; })[0]; if (l) SK.control.setOff(l, true); floor(r.floor); D.viewer.select(r.id); D.viewer.focusRoom(r.id); } },
    { title: '9. Відключення електроенергії', text: 'Мережа зникла: ДБЖ тримає критичні навантаження, через 30 с ДГУ запускається через АВР. Аудиторії переходять у «Резервне живлення», категорія III вимикається.',
      run: function () { D.setSimTime(1, '13:10'); SK.power.startOutage(false); D.setTab('power'); D.setColorMode('scenario'); } },
    { title: '10. Відновлення та енергія', text: 'Мережу відновлено. Графік енергії: суцільна лінія — з автоматикою, пунктир — без неї; провал — період роботи від генератора.',
      run: function () { D.setSimTime(1, '15:30'); SK.power.restore(); D.setTab('energy'); D.setColorMode('power'); } },
    { title: '11. Подія безпеки', text: 'Тестова подія: відчинено двері серверної без відбитка. Приміщення блимає червоним, подія — в журналі з підтвердженням і експортом CSV.',
      run: function () { D.setTab('security'); D.setColorMode('status'); var ev = SK.security.TESTS[0].run(); floor(0); D.viewer.select(ev.room); D.viewer.focusRoom(ev.room); } },
    { title: '12. Студентський застосунок', text: 'Студенти бачать лише онлайн-розклад, розклад подій, пошук аудиторій і оголошення — без датчиків і керування. Події створює адміністратор у вкладці «Події».',
      run: function () { D.setTab('events'); } }
  ];

  function show() {
    var s = STEPS[i];
    $('#tourStep').textContent = s.title;
    $('#tourText').textContent = s.text;
    $('#tourPrev').disabled = i === 0;
    $('#tourNext').textContent = i === STEPS.length - 1 ? 'Завершити' : 'Далі →';
    try { s.run(); } catch (e) { console.error(e); }
  }
  function start() { saved = { speed: store.clock.speed() }; store.clock.setSpeed(1); i = 0; $('#tour').hidden = false; show(); }
  function stop() { if (SK.tourFaults) { SK.faults.resetAll(); SK.tourFaults = false; } $('#tour').hidden = true; if (saved) store.clock.setSpeed(saved.speed); }

  document.addEventListener('DOMContentLoaded', function () {
    $('#tourBtn').onclick = start;
    $('#tourClose').onclick = stop;
    $('#tourPrev').onclick = function () { if (i > 0) { i--; show(); } };
    $('#tourNext').onclick = function () { if (i < STEPS.length - 1) { i++; show(); } else stop(); };
    if (location.hash === '#tour') setTimeout(start, 300);
    if (location.hash === '#tourtest') setTimeout(function () {     // самоперевірка: прогнати всі кроки
      var errs = [];
      STEPS.forEach(function (s, k) { try { s.run(); } catch (e) { errs.push((k + 1) + ': ' + e.message); } });
      document.title = errs.length ? 'TOURFAIL ' + errs.join(' | ') : 'TOUROK ' + STEPS.length;
    }, 300);
  });
  return { start: start, steps: STEPS };
})();
