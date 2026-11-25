#!/usr/bin/env node
/* Перезбирання знімка реального розкладу (js/data/real-schedule.js).
 *
 *   git clone --depth 1 https://github.com/shpatar26121974/nniftcn_schedule.git /tmp/nniftcn
 *   node tools/build-real-schedule.js /tmp/nniftcn/src/data/schedule.json [commit]
 *
 * У знімок потрапляють лише записи корпусу 9 (правила — js/core/schedule-import.js).
 * Після оновлення перевірте tests/selftest.html: якщо з'явилися нові аудиторії,
 * їм потрібне місце в моделі (js/data/building.js, функція placeReal).
 */
var fs = require('fs'), path = require('path');
global.window = global; global.SK = {};
require(path.join(__dirname, '../js/core/schedule-import.js'));
var I = SK.scheduleImport;

var src = process.argv[2], commit = process.argv[3] || '';
if (!src) { console.error('Вкажіть шлях до schedule.json'); process.exit(1); }
var raw = JSON.parse(fs.readFileSync(src, 'utf8'));
var DAYN = { 'Понеділок': 1, 'Вівторок': 2, 'Середа': 3, 'Четвер': 4, "П'ятниця": 5 };
var TY = { lecture: 'lecture', practice: 'practice', lab: 'lab' };
var rows = raw.filter(function (o) { return I.roomKey(o.room); }).map(function (o) {
  return [DAYN[o.day] || o.day, o.period, o.week, o.group, o.subject, o.teacher, o.room, TY[o.type] || 'practice'];
});
var b = I.build(rows);
var cat = I.catalog(b.lessons).sort(function (a, c) { return a.id.localeCompare(c.id, 'uk', { numeric: true }); });
var out = '/* ЗНІМОК реального розкладу занять корпусу № 9 — згенеровано tools/build-real-schedule.js.\n' +
  ' * Джерело: розклад ННІФТКН ЧНУ, II семестр 2025–2026 (https://ptcsi.chnu.edu.ua/ → «Розклад занять»,\n' +
  ' * https://shpatar26121974.github.io/nniftcn_schedule/). Не редагуйте вручну — перезберіть скриптом.\n' +
  ' * rows: [день 1–5, пара, тиждень 1|2, група, дисципліна, викладач, аудиторія як у джерелі, тип] */\n' +
  'SK.realSchedule = ' + JSON.stringify({
    source: { name: 'Розклад занять ННІФТКН ЧНУ', semester: 'II семестр 2025–2026',
      url: 'https://shpatar26121974.github.io/nniftcn_schedule/', page: 'https://ptcsi.chnu.edu.ua/studentu/rozklad-zaniat-ta-zalikovo-ekzamenatsiinykh-sesii/',
      commit: commit, total: raw.length, built: new Date().toISOString().slice(0, 10) },
    rooms: cat.map(function (c) { return [c.id, c.lecture, c.practice, c.lab, c.maxPeople]; }),
    rows: rows
  }) .replace(/\],\[/g, '],\n[') + ';\n';
fs.writeFileSync(path.join(__dirname, '../js/data/real-schedule.js'), out);
console.log('рядків джерела', raw.length, '→ корпус 9:', rows.length, '| занять', b.report.lessons, '| потоків', b.report.streams,
  '| груп', b.report.groups, '| аудиторій', cat.length);
console.log(cat.map(function (c) { return c.id + '(' + c.maxPeople + (c.lab > c.lecture + c.practice ? ' lab' : c.lecture > c.practice ? ' lec' : '') + ')'; }).join(' '));
