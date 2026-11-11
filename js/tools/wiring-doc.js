/* Документ «Опис елементів системи та їх комутації» (.docx).
 * Будується з тих самих даних, що й панель (реєстр пристроїв, карта комутації),
 * тому після зміни планів чи обладнання достатньо згенерувати документ заново. */
SK.wiringDoc = (function () {
  var B = SK.building, REG = SK.devicesI3, W = SK.wiring, PW = SK.power, SEC = SK.security, U = SK.util;

  function L(b) { return b === 'A' ? 'А' : b === 'B' ? 'Б' : b === 'C' ? 'Перемичка' : 'Територія'; }
  function sum(o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); }
  function ctrlSummary(list) { var c = {}; list.forEach(function (m) { c[m] = (c[m] || 0) + 1; }); return Object.keys(c).map(function (m) { return m + (c[m] > 1 ? ' ×' + c[m] : ''); }).join(', '); }
  function portsText(pool) { return Object.keys(pool.ports).map(function (t) { return t + ' × ' + pool.ports[t]; }).join(', '); }

  var PURPOSE = {
    pir: 'Присутність людей: автоувімкнення світла, сценарії, автовимкнення', temp: 'Температура повітря для клімат-контролю',
    co2: 'Якість повітря (CO₂, T, RH): керування вентиляцією', pm: 'Дим / PM2.5 у кімнаті для куріння', light: 'Димоване LED-освітлення приміщення',
    hvac: 'Фанкойл / припливна установка (уставка, швидкість)', exhaust: 'Витяжка кімнати для куріння (розрідження)', blinds: 'Жалюзі за сценарієм (вгору/вниз)',
    sockets: 'Знеструмлення ПК і проєкторів без людей', board: 'Інтерактивна онлайн-дошка, запис конспекту', signage: 'Розклад, події, навігація',
    panel: 'Ручний вибір сценарію в аудиторії', finger: 'Безключовий доступ за відбитком пальця', turnstile: 'Прохід у корпус за відбитком',
    door: 'Стан дверей (відчинено / зачинено)', leak: 'Протікання води', vape: 'Куріння / вейп поза дозволеними місцями', camera: 'Відеоспостереження (концепт)',
    wifi: 'Бездротова мережа', cabinet: 'Шафа автоматики поверху', server: 'Сервер системи та MQTT-брокер', accsrv: 'Сервер біометричного доступу',
    core: 'Ядро мережі корпусу', console: 'Робоче місце диспетчера', upsc: 'Центральний ДБЖ (категорія I)', upscab: 'ДБЖ шафи (контролери, датчики, замки)',
    ats: 'Автоматичне введення резерву', gen: 'Резервне джерело — ДГУ', meter: 'Облік електроенергії поверху', parking: 'Зайнятість паркомісць',
    bench: 'Лавка з USB-зарядкою та підсвіткою', pole: 'Вуличне освітлення за PIR'
  };

  function build() {
    var d = SK.docx.doc(), now = new Date();
    var tot = REG.totals(), links = W.links;

    /* ---------- Титул ---------- */
    d.title('Розумний корпус · навчальний корпус № 9 ЧНУ (ННІФТКН)', 'Опис елементів системи та їх комутації');
    d.p('Команда «Ша-Пі-То»: Вакарюк Іван (дизайн і 3D), Шестобуз Олег (програмна частина), Реус Ірина (маскот «Шахеда»).');
    d.p('Дата формування: ' + U.fmtDateTime(now) + '. Документ згенеровано автоматично з даних прототипу.');
    d.note('Статус: КОНЦЕПТ для навчального проєкту. Поділ на приміщення демонстраційний; кількість портів контролерів умовна; довжини кабелів — оцінка «по осях» ' +
      '(траса + підйом + 3 м запасу). Перед монтажем потрібні обстеження корпусу, проєкт електропостачання та погодження з i3 Engineering і адміністрацією ЧНУ.');

    /* ---------- 1. Загальна схема ---------- */
    d.h1('1. Загальна схема комутації');
    d.p('Кожен поверх кожного блоку обслуговує окрема шафа автоматики ЩА. Кабелі від пристроїв приміщення сходяться в **розподільчу коробку (РК)** біля дверей, далі — лотком у коридорі до шафи свого поверху. Шафи з\'єднані з **серверною А-002** (мережа) і живляться від **ГРЩ А-003** через центральний ДБЖ.');
    d.table(['Рівень', 'Елементи', 'Зв\'язок із наступним рівнем'], [
      ['1. Пристрої', 'Датчики, світильники, приводи, зчитувачі, дошки, камери', 'Кабель до РК приміщення (тип — за шиною)'],
      ['2. Розподільча коробка', 'РК-<номер приміщення>, під стелею біля дверей', 'Лоток у коридорі до шафи поверху'],
      ['3. Шафа ЩА поверху', 'Контролери Atom, контролер доступу, PoE-комутатор, ДБЖ 24 В', 'Аплінк (оптика / UTP) до ядра мережі'],
      ['4. Серверна А-002', 'Сервер «Розумного корпусу», MQTT-брокер, сервер доступу, ядро мережі, ДБЖ 20 кВА', 'MQTT, REST / WebSocket'],
      ['5. Інтерфейси', 'Панель адміністрування (index.html), студентський застосунок', 'Лише читання / команди сценаріїв']
    ], [18, 44, 38]);

    /* ---------- 2. Приміщення ---------- */
    d.h1('2. Корпус і шафи за поверхами');
    var rows = [];
    ['A', 'B'].forEach(function (b) {
      for (var f = B.minFloor; f <= B.maxFloor; f++) {
        var rs = B.rooms.filter(function (r) { return r.block === b && r.floor === f; });
        var cab = REG.cabinets.filter(function (c) { return c.block === b && c.floor === f; })[0];
        rows.push(['Блок ' + L(b), f === 0 ? '0 (хол)' : String(f), rs.filter(function (r) { return r.bookable; }).length,
          rs.filter(function (r) { return !r.bookable && r.type !== 'wc' && r.type !== 'stairs' && r.type !== 'smoking'; }).length,
          rs.filter(function (r) { return r.type === 'wc'; }).length, rs.filter(function (r) { return r.type === 'smoking'; }).length,
          cab.id + ' (' + REG.devices.filter(function (x) { return x.cabinet === cab.id; }).length + ' пристр.)']);
      }
    });
    d.table(['Блок', 'Поверх', 'Аудиторії', 'Службові', 'Санвузли', 'Кімн. для куріння', 'Шафа'], rows, [14, 10, 12, 12, 12, 14, 26]);
    d.p('Адміністративне приміщення — **А-001** (диспетчерська), поруч серверна **А-002** та електрощитова **А-003** (ГРЩ, АВР). Перемичка (рівень 1-го поверху) — шафа ЩА-П1; територія — ЩА-Т.');

    /* ---------- 3. Контролери ---------- */
    d.h1('3. Контролери та їх призначення');
    d.p('Підбір — серія **Atom** (i3 Engineering, Львів) за функцією; контролер доступу й PoE-комутатор — сторонні. Кількість — з автоматичного розподілу портів.');
    d.table(['Модель', 'Розмір', 'Призначення', 'Порти (умовно)', 'К-сть'], Object.keys(W.POOLS).map(function (m) {
      return [m, REG.CATALOG[m] ? REG.CATALOG[m].u : '—', REG.CATALOG[m] ? REG.CATALOG[m].role : '', portsText(W.POOLS[m]), tot.controllers[m] || 0];
    }), [22, 9, 41, 20, 8]);

    /* ---------- 4. Пристрої ---------- */
    d.h1('4. Розумні пристрої та спосіб підключення');
    var kinds = Object.keys(tot.kinds);
    d.table(['Пристрій', 'Категорія', 'К-сть', 'Контролер · порт', 'Шина / кабель', 'Призначення'], kinds.map(function (k) {
      var ex = REG.devices.filter(function (x) { return x.kind === k; })[0], c = ex.conn || [];
      return [REG.KINDS[k].name, REG.CATS[REG.KINDS[k].cat].name, tot.kinds[k],
        c.map(function (l) { return (l.inst ? l.inst.model : '—') + ' · ' + l.type; }).join('\n') || '—',
        c.map(function (l) { return W.BUS[l.type].name + ': ' + l.cable; }).join('\n') || '—', PURPOSE[k] || ''];
    }), [20, 12, 7, 20, 22, 19]);
    d.p('Разом: **' + REG.devices.length + '** пристроїв, **' + links.length + '** з\'єднань.');

    /* ---------- 5. Шафи ---------- */
    d.h1('5. Шафи автоматики');
    d.table(['Шафа', 'Розташування', 'Склад', 'Зайнято портів', 'Живлення', 'Аплінк'], REG.cabinets.map(function (c) {
      var used = {}; (c.instances || []).forEach(function (i) { Object.keys(i.used).forEach(function (t) { used[t] = (used[t] || 0) + i.used[t]; }); });
      var feed = W.feeds.filter(function (f) { return f.cabinet === c.id; })[0];
      return [c.id + '\n≈ ' + c.units + ' мод. DIN', c.territory ? 'Майданчик ДГУ' : 'Блок ' + L(c.block) + ', поверх ' + c.floor + ', біля сходів',
        ctrlSummary(c.controllers), Object.keys(used).map(function (t) { return t + ': ' + used[t]; }).join(', '),
        feed.from + '\n' + feed.cable + ' ≈ ' + feed.len + ' м', 'Оптика / UTP до А-002'];
    }), [12, 16, 30, 17, 15, 10]);

    /* ---------- 6. Типові приміщення ---------- */
    d.h1('6. Структура типових приміщень');
    d.p('Для кожного типу наведено один приклад (решта приміщень того самого типу комутуються так само).');
    var seen = {};
    B.rooms.forEach(function (r) {
      if (seen[r.type] || !REG.roomDevices(r).length) return; seen[r.type] = 1;
      var jb = W.jbox(r.id), rl = W.forRoom(r.id);
      d.h2(r.id + ' — ' + r.name);
      d.p(B.types[r.type].name + ' · ' + r.area + ' м²' + (r.capacity ? ' · ' + r.capacity + ' місць' : '') + ' · розподільча коробка ' + jb.id + ' → шафа ' + REG.roomDevices(r)[0].cabinet +
        ' · кабелю ≈ ' + rl.reduce(function (a, l) { return a + l.len; }, 0) + ' м');
      d.table(['Пристрій', 'Контролер', 'Порт', 'Кабель', '≈ м'], rl.map(function (l) {
        return [REG.KINDS[l.device.kind].name, l.inst ? l.inst.id : '—', l.port, l.cable, l.len || '—'];
      }), [32, 20, 18, 22, 8]);
    });

    /* ---------- 7. Кабелі ---------- */
    d.h1('7. Кабельний журнал (підсумок)');
    var cb = W.cables();
    d.table(['Кабель', 'Довжина, м (оцінка)'], Object.keys(cb).map(function (k) { return [k, cb[k]]; }).concat([['Разом', sum(cb)]]), [70, 30]);
    d.note('До оцінки слід додати 10–15 % на опуски, лотки й переходи між поверхами.');

    /* ---------- 8. Живлення ---------- */
    d.h1('8. Резервне живлення');
    d.table(['Категорія', 'Джерело', 'Навантаження'], Object.keys(PW.CATS).map(function (k) {
      var c = PW.CATS[k]; return [c.name + (c.kw ? ' (≈ ' + c.kw + ' кВт)' : ''), c.src, c.items];
    }), [22, 18, 60]);
    d.table(['Обладнання', 'Розташування', 'Примітка'], Object.keys(PW.DESIGN).map(function (k) {
      var x = PW.DESIGN[k]; return [x.name, x.where, x.feeds || (x.autonomyMin ? 'автономія ≈ ' + x.autonomyMin + ' хв' : x.fuelHours ? 'паливо ≈ ' + x.fuelHours + ' год, пуск ' + x.startSec + ' с' : '')];
    }), [30, 30, 40]);
    d.p('Стан ДБЖ, АВР і ДГУ передається через Modbus у Atom Cobalt. Контролери, датчики, зчитувачі й замки мають ДБЖ у шафі й працюють без сервера; сервер вимикається коректно при заряді ≤ 10 %.');

    /* ---------- 9. Доступ ---------- */
    d.h1('9. Безключовий доступ за відбитками пальців');
    d.table(['Зона', 'Двері'], Object.keys(SEC.ZONES).map(function (z) {
      var ds = SEC.doors.filter(function (x) { return x.zone === z; });
      return [SEC.ZONES[z], ds.length + ': ' + ds.slice(0, 12).map(function (x) { return x.room; }).join(', ') + (ds.length > 12 ? '…' : '')];
    }), [35, 65]);
    d.table(['Група', 'Зони', 'Час'], Object.keys(SEC.GROUPS).map(function (k) {
      var g = SEC.GROUPS[k]; return [g.name, g.zones.map(function (z) { return SEC.ZONES[z]; }).join('; '), g.days.map(function (x) { return U.DAYS_SHORT[x]; }).join(' ') + ' ' + g.from + '–' + g.to];
    }), [22, 53, 25]);
    d.bullets([
      'Зчитувач відбитків підключається до контролера доступу (OSDP / RS-485); команда на електрозамок — релейний вихід Atom Argon; стан дверей — геркон на вхід Atom Argon.',
      'Шаблони відбитків зберігаються лише в зашифрованому вигляді на сервері / контролері доступу; потрібна письмова згода, альтернатива — картка або PIN.',
      'Двері на шляхах евакуації розблоковує сертифікована система пожежної сигналізації, не система «Розумного корпусу».'
    ]);

    /* ---------- 10. Обмеження ---------- */
    d.h1('10. Обмеження та що уточнити');
    d.bullets([
      'Офіційні плани поверхів і реальне розташування приміщень (зараз — демонстраційне).',
      'Кількість входів / виходів кожної моделі Atom і формат MQTT-топіків — за документацією i3 Engineering.',
      'Проєкт електропостачання (потужності ДГУ, ДБЖ, перерізи кабелів, автомати захисту).',
      'Постачальник біометричного доступу та порядок обробки персональних даних.',
      'Кімнати для куріння: ст. 13 Закону України № 2899-IV забороняє куріння в приміщеннях закладів освіти — облаштування потребує погодження з адміністрацією та юристом.'
    ]);

    /* ---------- Додаток А ---------- */
    d.pageBreak();
    d.h1('Додаток А. Повна таблиця комутації за шафами');
    REG.cabinets.forEach(function (c) {
      var ls = W.forCabinet(c.id);
      if (!ls.length) return;
      d.h2(c.id + ' · ' + (c.territory ? 'територія' : 'блок ' + L(c.block) + ', поверх ' + c.floor) + ' · ' + ls.length + ' з\'єднань');
      d.table(['Контролер', 'Порт', 'Пристрій', 'Приміщення', 'Кабель', '≈ м'], ls.map(function (l) {
        return [l.inst ? l.inst.short : '—', l.port, REG.KINDS[l.device.kind].name, l.device.room || l.device.label || l.device.zone || '', l.cable, l.len || '—'];
      }), [10, 15, 30, 13, 24, 8]);
    });
    return d.build({ title: 'Розумний корпус К9 — опис елементів і комутації', author: 'Команда «Ша-Пі-То»', footer: 'Розумний корпус К9 · опис комутації' });
  }

  function download() { SK.docx.download(build(), 'Rozumnyi_korpus_K9_komutatsiia.docx'); }
  return { build: build, download: download };
})();
