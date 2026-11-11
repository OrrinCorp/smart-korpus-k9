/* Територія корпусу: парковки, зона відпочинку, майданчик ДГУ.
 *
 * Координати перенесено з генплану korpus_terytoriya_3.svg (1 м = 8 px):
 *   x(план) = (x_svg − 88) / 8 − 34,   y(план) = 64 − (y_svg − 106) / 8.
 * Межі ділянки НЕВІДОМІ — розміщення зон треба перевірити на місці.
 *
 * Місць для куріння на території немає: кімнати для куріння з окремою
 * витяжкою — на кожному поверсі (js/data/building.js, тип «smoking»).
 */
SK.territory = (function () {
  function sx(x) { return (x - 88) / 8 - 34; }
  function sy(y) { return 64 - (y - 106) / 8; }

  var zones = [
    { id: 'P1', kind: 'parking', name: 'Парковка P1 (схід)', x0: sx(664), x1: sx(792), y0: sy(618), y1: sy(358),
      rows: 'y', spots: 26, mgn: 2 },
    { id: 'P2', kind: 'parking', name: 'Парковка P2 (північ)', x0: sx(400), x1: sx(640), y0: sy(314), y1: sy(186),
      rows: 'x', spots: 24, mgn: 2 },
    { id: 'REST', kind: 'rest', name: 'Зона відпочинку', x0: sx(240), x1: sx(376), y0: sy(698), y1: sy(534) },
    { id: 'GEN', kind: 'gen', name: 'Майданчик ДГУ (резервне живлення)', x0: 38, x1: 44, y0: 40, y1: 45,
      note: 'Дизель-генераторна установка в кожусі з АВР. Місце, потужність і підключення визначає проєктувальник електропостачання.' }
  ];

  /* Паркомісця 2,5 × 5 м у два ряди з проїздом 6 м посередині (як на генплані) */
  var spots = [];
  zones.filter(function (z) { return z.kind === 'parking'; }).forEach(function (z) {
    var perRow = z.spots / 2, n = 0;
    for (var row = 0; row < 2; row++) {
      for (var i = 0; i < perRow; i++) {
        var s = { id: z.id + '-' + (++n), lot: z.id, mgn: false };
        if (z.rows === 'y') {        // P1: ряди вздовж осі y, місця 5 м уздовж x
          s.x0 = row ? z.x1 - 5 : z.x0; s.x1 = s.x0 + 5;
          s.y1 = z.y1 - i * 2.5; s.y0 = s.y1 - 2.5;
          s.mgn = i === perRow - 1;
        } else {                     // P2: ряди вздовж осі x
          s.y0 = row ? z.y0 : z.y1 - 5; s.y1 = s.y0 + 5;
          s.x0 = z.x0 + i * 2.5; s.x1 = s.x0 + 2.5;
          s.mgn = row === 1 && i < 2;
        }
        spots.push(s);
      }
    }
  });

  var trees = [[258, 556], [358, 556], [258, 680], [358, 680]].map(function (p) { return { x: sx(p[0]), y: sy(p[1]) }; });
  var benches = [{ x: sx(308), y: sy(652), smart: true }, { x: sx(308), y: sy(668), smart: true }];
  /* Пішохідні шляхи від зони відпочинку до парковок (пунктир на генплані) */
  var paths = [
    [[376, 658], [728, 658], [728, 621]],
    [[656, 658], [656, 250], [644, 250]]
  ].map(function (pl) { return pl.map(function (p) { return { x: sx(p[0]), y: sy(p[1]) }; }); });

  function zone(id) { return zones.filter(function (z) { return z.id === id; })[0]; }

  return { zones: zones, spots: spots, trees: trees, benches: benches, paths: paths, zone: zone,
    note: 'Межі ділянки, в’їзди та ухили не перевірено — розміщення зон уточнити.' };
})();
