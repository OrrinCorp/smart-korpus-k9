/* Режим «Модель кімнати»: окрема детальна 3D-модель одного приміщення.
 *
 * Будується процедурно з даних (габарити, тип, двері, вікна, пристрої, комутація):
 *  - стіни з дверним прорізом і вікнами (стіни між камерою та кімнатою автоматично
 *    «зрізаються», як у ляльковому будиночку); жалюзі — за активним сценарієм;
 *  - меблі за типом приміщення (аудиторія, комп'ютерний клас, лабораторія, санвузол,
 *    серверна, диспетчерська, кімната для куріння…), люди — за PIR-датчиком;
 *  - розумні пристрої на своїх місцях, світильники світять за сценарієм;
 *  - кабелі від пристроїв до розподільчої коробки та далі до шафи ЩА (колір — тип шини).
 * Можна завантажити власну .glb-модель кімнати (зберігається в браузері).
 * Видимість деталей залежить від ролі: гість — без пристроїв і кабелів,
 * відповідальна особа — без комутації, адміністратор — усе.
 */
SK.RoomView = (function () {
  var U = SK.util, B = SK.building, REG = SK.devicesI3, W = SK.wiring, esc = U.esc;
  var el, view, side, renderer, scene, camera, controls, raf = null, ro = null;
  var G = {}, room = null, walls = [], lightMeshes = [], pickables = [], selDev = null, pointLight = null, tip;
  var layers = { furniture: true, devices: true, cables: true, people: true, labels: true };
  var center = new THREE.Vector3();

  function role() { return SK.store.state.role; }
  function canSee(what) {
    var r = role();
    if (what === 'devices') return r !== 'guest';
    if (what === 'cables' || what === 'ports' || what === 'model') return r === 'admin';
    return true;
  }

  /* ---------- DOM ---------- */
  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'rm-modal'; el.hidden = true;
    el.innerHTML = '<div class="rm-head"><div class="grow"><b id="rmTitle"></b> <span class="muted small" id="rmSub"></span></div>' +
      '<div class="row small" id="rmLayers"></div>' +
      '<button class="btn small" id="rmPrev" title="Попереднє приміщення">◀</button><button class="btn small" id="rmNext" title="Наступне приміщення">▶</button>' +
      '<button class="btn small" id="rmHome" title="Типовий вигляд">⌂</button>' +
      '<button class="btn small" id="rmClose" aria-label="Закрити">✕ Закрити</button></div>' +
      '<div class="rm-body"><div class="rm-view viewer" id="rmView"></div><aside class="rm-side" id="rmSide"></aside></div>';
    document.body.appendChild(el);
    view = el.querySelector('#rmView'); side = el.querySelector('#rmSide');
    tip = document.createElement('div'); tip.className = 'viewer-tip'; tip.hidden = true; view.appendChild(tip);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    view.appendChild(renderer.domElement); renderer.domElement.className = 'viewer-canvas';
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 2; controls.maxDistance = 60;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.75));
    var sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.position.set(10, 20, 12); scene.add(sun);
    pointLight = new THREE.PointLight(0xfff4dd, 0.6, 30); scene.add(pointLight);

    el.querySelector('#rmClose').onclick = close;
    el.querySelector('#rmHome').onclick = home;
    el.querySelector('#rmPrev').onclick = function () { step(-1); };
    el.querySelector('#rmNext').onclick = function () { step(1); };
    document.addEventListener('keydown', function (e) { if (!el.hidden && e.key === 'Escape') close(); });
    el.querySelector('#rmLayers').addEventListener('change', function (e) {
      if (!e.target.dataset.layer) return;
      layers[e.target.dataset.layer] = e.target.checked; applyLayers();
    });
    side.addEventListener('click', onSideClick);
    side.addEventListener('change', onSideChange);

    var ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), down = null;
    function pick(e) {
      var rc = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rc.left) / rc.width) * 2 - 1; mouse.y = -((e.clientY - rc.top) / rc.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      var hit = ray.intersectObjects(pickables.filter(function (o) { return o.visible && o.parent && o.parent.visible; }), false)[0];
      return hit ? hit.object.userData.dev : null;
    }
    renderer.domElement.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', function (e) {
      if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 6) return;
      selDev = pick(e); highlight(); renderSide();
    });
    renderer.domElement.addEventListener('pointermove', function (e) {
      var d = pick(e);
      if (d) {
        var rc = view.getBoundingClientRect(), s = SK.devices.state(d, SK.store.clock.now());
        tip.innerHTML = REG.KINDS[d.kind].icon + ' <b>' + esc(d.name) + '</b><br>' + esc(s.value || '');
        tip.style.left = (e.clientX - rc.left + 14) + 'px'; tip.style.top = (e.clientY - rc.top + 14) + 'px'; tip.hidden = false;
        renderer.domElement.style.cursor = 'pointer';
      } else { tip.hidden = true; renderer.domElement.style.cursor = ''; }
    });
    ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(view);
  }

  function resize() {
    var w = view.clientWidth || 1, h = view.clientHeight || 1;
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  /* ---------- Геометрія ---------- */
  var r, cx, cy, Wd, Dp, H;
  function L(x, y, z) { return new THREE.Vector3(x - cx, z - r.z0, -(y - cy)); }   // план → локальні координати
  function mat(c, o) { var m = new THREE.MeshLambertMaterial({ color: c }); if (o != null) { m.transparent = true; m.opacity = o; } return m; }
  function box(g, w, h, d, c, x, y, z, o) {     // x,z — локальні (центр кімнати = 0), y — низ
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? mat(c, o) : c);
    m.position.set(x, y + h / 2, z); g.add(m); return m;
  }
  function label(text, px, bg) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 96;
    var g = c.getContext('2d');
    g.font = 'bold ' + px + 'px Arial';
    while (g.measureText(text).width > 470 && px > 14) { px -= 2; g.font = 'bold ' + px + 'px Arial'; }   // довгі назви — менший шрифт
    var tw = Math.min(500, g.measureText(text).width + 30);
    var dk = SK.theme && SK.theme.isDark();
    g.fillStyle = bg || (dk ? 'rgba(16,19,22,.94)' : 'rgba(255,255,255,.92)'); g.fillRect((512 - tw) / 2, 14, tw, 68);
    g.strokeStyle = dk ? '#5a666e' : '#33424c'; g.lineWidth = 3; g.strokeRect((512 - tw) / 2, 14, tw, 68);
    g.fillStyle = dk ? '#e6ebee' : '#1c2a33'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 50);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.renderOrder = 20;
    s.scale.set(3.2, 0.6, 1); return s;
  }
  var texCache = {};
  function devTex(kind, status) {
    var key = kind + status; if (texCache[key]) return texCache[key];
    var k = REG.KINDS[kind], cat = REG.CATS[k.cat];
    var c = document.createElement('canvas'); c.width = c.height = 96; var g = c.getContext('2d');
    g.beginPath(); g.arc(48, 48, 42, 0, Math.PI * 2); g.fillStyle = status === 'alarm' ? '#ffd9d9' : '#fff'; g.fill();
    g.lineWidth = 8; g.strokeStyle = status === 'alarm' ? '#d23c3c' : status === 'fault' ? '#d99a1e' : cat.css; g.stroke();
    if (status === 'active') { g.beginPath(); g.arc(78, 18, 11, 0, Math.PI * 2); g.fillStyle = '#2e9e5b'; g.fill(); }
    g.font = '44px "Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k.icon, 48, 52);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return (texCache[key] = new THREE.SpriteMaterial({ map: t, depthTest: false }));
  }

  /* Сторони кімнати: S (y0), N (y1), W (x0), E (x1) */
  function sideOf(p) {
    var d = [['W', Math.abs(p.x - r.x0)], ['E', Math.abs(p.x - r.x1)], ['S', Math.abs(p.y - r.y0)], ['N', Math.abs(p.y - r.y1)]];
    d.sort(function (a, b) { return a[1] - b[1]; }); return d[0][0];
  }

  function buildWalls(g) {
    walls = [];
    var door = REG.doorOf(r), dSide = sideOf(door);
    var dAlong = dSide === 'W' || dSide === 'E' ? U.clamp(door.y, r.y0 + 0.8, r.y1 - 0.8) : U.clamp(door.x, r.x0 + 0.8, r.x1 - 0.8);
    var ext = REG.exterior(r).map(function (e) { return e.side; });
    var wallMat = mat(SK.theme && SK.theme.isDark() ? 0x3a4248 : 0xeae6df), lowMat = mat(SK.theme && SK.theme.isDark() ? 0x2c3338 : 0xd9d3c8), T = 0.15;
    ['S', 'N', 'W', 'E'].forEach(function (s) {
      var horiz = s === 'S' || s === 'N', a0 = horiz ? r.x0 : r.y0, a1 = horiz ? r.x1 : r.y1, len = a1 - a0;
      var openings = [];
      if (s === dSide) openings.push({ a: dAlong - 0.6, b: dAlong + 0.6, lo: 0, hi: 2.2, door: true });
      if (ext.indexOf(s) >= 0 && r.type !== 'stairs') {
        var n = Math.max(1, Math.floor(len / 3.2));
        for (var i = 0; i < n; i++) {
          var c = a0 + len * (i + 0.5) / n;
          if (openings.some(function (o) { return Math.abs(o.a + 0.6 - c) < 1.8; })) continue;
          openings.push({ a: c - 0.8, b: c + 0.8, lo: 0.9, hi: 2.6, win: true });
        }
      }
      openings.sort(function (x, y) { return x.a - y.a; });
      var full = new THREE.Group(), low = new THREE.Group();
      function seg(p0, p1, y0, y1, grp, m) {
        if (p1 - p0 < 0.01 || y1 - y0 < 0.01) return;
        var mid = (p0 + p1) / 2, w = p1 - p0, h = y1 - y0, pos;
        if (horiz) pos = L(mid, s === 'S' ? r.y0 : r.y1, r.z0 + y0);
        else pos = L(s === 'W' ? r.x0 : r.x1, mid, r.z0 + y0);
        var mesh = new THREE.Mesh(new THREE.BoxGeometry(horiz ? w : T, h, horiz ? T : w), m);
        mesh.position.set(pos.x, pos.y + h / 2, pos.z); grp.add(mesh);
        var e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x8a8378 }));
        e.position.copy(mesh.position); grp.add(e);
      }
      var p = a0;
      openings.forEach(function (o) {
        seg(p, o.a, 0, H, full, wallMat); seg(o.a, o.b, o.hi, H, full, wallMat); if (o.lo > 0) seg(o.a, o.b, 0, o.lo, full, wallMat);
        seg(p, o.a, 0, 1, low, lowMat); if (o.lo > 0) seg(o.a, o.b, 0, Math.min(1, o.lo), low, lowMat);
        var mid = (o.a + o.b) / 2, pos = horiz ? L(mid, s === 'S' ? r.y0 : r.y1, r.z0 + o.lo) : L(s === 'W' ? r.x0 : r.x1, mid, r.z0 + o.lo);
        if (o.win) {
          var glass = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 1.6 : 0.04, o.hi - o.lo, horiz ? 0.04 : 1.6), mat(0x9fd0ef, 0.35));
          glass.position.set(pos.x, pos.y + (o.hi - o.lo) / 2, pos.z); full.add(glass);
          o.pos = pos; o.horiz = horiz; o.side = s; G.windows.push(o);
        }
        if (o.door) {
          var leaf = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 1.1 : 0.05, 2.15, horiz ? 0.05 : 1.1), mat(0x9a7b55));
          var open = new THREE.Group(); open.position.set(pos.x - (horiz ? 0.55 : 0), 0, pos.z - (horiz ? 0 : 0.55)); full.add(open);
          leaf.position.set(horiz ? 0.55 : 0, 1.075, horiz ? 0 : 0.55); open.add(leaf); open.rotation.y = horiz ? -0.9 : 0.9;
          var dl = label(r.closed ? '☝ Вхід за відбитком' : 'Вхід', 30); dl.position.set(pos.x, 2.6, pos.z); dl.scale.set(2.4, 0.45, 1); G.labels.add(dl);
        }
        p = o.b;
      });
      seg(p, a1, 0, H, full, wallMat); seg(p, a1, 0, 1, low, lowMat);
      var normal = s === 'S' ? new THREE.Vector3(0, 0, 1) : s === 'N' ? new THREE.Vector3(0, 0, -1) : s === 'W' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
      g.add(full); g.add(low); low.visible = false;
      walls.push({ full: full, low: low, normal: normal, side: s });
    });
    G.doorSide = dSide; G.doorAlong = dAlong;
  }

  function front() {   // напрям «до дошки»: протилежно дверям
    var s = G.doorSide;
    return s === 'S' ? 'N' : s === 'N' ? 'S' : s === 'W' ? 'E' : 'W';
  }

  /* ---------- Меблі за типом ---------- */
  var seats = [];
  function buildFurniture(g) {
    seats = [];
    var t = r.type, fs = front(), along = fs === 'N' || fs === 'S';
    var hw = Wd / 2, hd = Dp / 2;
    /* Перетворення «рядів» у локальні координати: u — поперек рядів, v — від дошки вглиб */
    function UV(u, v) {
      if (fs === 'N') return { x: u, z: -hd + v };
      if (fs === 'S') return { x: u, z: hd - v };
      if (fs === 'E') return { x: hw - v, z: u };
      return { x: -hw + v, z: u };
    }
    var span = along ? Wd : Dp, depth = along ? Dp : Wd;
    function desk(u, v, w, d, c, h) { var p = UV(u, v); return box(g, along ? w : d, h || 0.75, along ? d : w, c, p.x, 0, p.z); }
    function rows(deskW, deskD, gap, startV, pc, lab) {
      var cols = Math.max(1, Math.floor((span - 1.6) / (deskW + 0.6))), v = startV;
      while (v + deskD < depth - 0.8) {
        for (var c = 0; c < cols; c++) {
          var u = -span / 2 + 0.8 + deskW / 2 + c * ((span - 1.6 - deskW) / Math.max(1, cols - 1));
          if (cols === 1) u = 0;
          desk(u, v, deskW, deskD, lab ? 0xdcdfe2 : 0xc8a070);
          if (pc) { var n = Math.max(1, Math.round(deskW / 0.9)); for (var k = 0; k < n; k++) { var uu = u - deskW / 2 + (k + 0.5) * deskW / n; desk(uu, v + 0.05, 0.5, 0.06, 0x2b3238, 0.4).position.y = 0.95; seats.push(UV(uu, v + deskD + 0.35)); } }
          else { var m = Math.max(1, Math.round(deskW / 0.65)); for (var j = 0; j < m; j++) seats.push(UV(u - deskW / 2 + (j + 0.5) * deskW / m, v + deskD + 0.35)); }
          if (lab) desk(u, v, 0.5, 0.3, 0x5c7080, 0.3).position.y = 0.9;
        }
        v += deskD + gap;
      }
    }
    function boardWall() {
      var b = null;   // дошка — пристрій «онлайн-дошка» (малюється окремо)
      var t2 = UV(span / 2 - 1.2, 1.2); box(g, along ? 1.4 : 0.7, 0.76, along ? 0.7 : 1.4, 0x9a7b55, t2.x, 0, t2.z);   // стіл викладача
      return b;
    }
    if (t === 'lecture' || t === 'seminar') { boardWall(); rows(t === 'lecture' ? 2.4 : 1.4, 0.5, 0.45, 2.6); }
    else if (t === 'computer') { boardWall(); rows(1.8, 0.7, 0.6, 2.4, true); }
    else if (t === 'lab') { boardWall(); rows(2.4, 0.9, 0.9, 2.6, false, true); }
    else if (t === 'cowork') { for (var i = 0; i < 6; i++) { var p = UV(-span / 2 + 2 + (i % 3) * (span - 4) / 2, 2 + Math.floor(i / 3) * (depth - 4)); box(g, 1.6, 0.75, 1.0, 0x7fb3a4, p.x, 0, p.z); seats.push({ x: p.x + 0.9, z: p.z }); seats.push({ x: p.x - 0.9, z: p.z }); } }
    else if (t === 'office' || t === 'security') {
      var n2 = Math.max(1, Math.floor(span / 2.2));
      for (var o = 0; o < n2; o++) { var u2 = -span / 2 + 1.2 + o * (span - 2.4) / Math.max(1, n2 - 1); if (n2 === 1) u2 = 0; desk(u2, depth * 0.45, 1.4, 0.7, 0xb08860); desk(u2, depth * 0.45 + 0.1, 0.5, 0.05, 0x2b3238, 0.4).position.y = 0.95; seats.push(UV(u2, depth * 0.45 + 1)); }
      for (var c2 = 0; c2 < 3; c2++) desk(-span / 2 + 0.6 + c2 * 0.9, 0.3, 0.8, 0.45, 0x8a8f94, 1.9);
    } else if (t === 'admin') {
      var vw = UV(0, 0.1); box(g, along ? Math.min(6, span - 1) : 0.08, 1.8, along ? 0.08 : Math.min(6, span - 1), 0x111820, vw.x, 0.9, vw.z);   // відеостіна
      for (var a = -1; a <= 1; a++) { desk(a * 1.8, 2.6 + Math.abs(a) * 0.4, 1.6, 0.8, 0x6b7a86); desk(a * 1.8, 2.7 + Math.abs(a) * 0.4, 1.2, 0.05, 0x1b2228, 0.45).position.y = 1.0; seats.push(UV(a * 1.8, 3.8 + Math.abs(a) * 0.4)); }
    } else if (t === 'server') {
      for (var rr = 0; rr < Math.floor((span - 1) / 0.7); rr++) { var k2 = UV(-span / 2 + 0.8 + rr * 0.7, depth / 2); var rack = box(g, along ? 0.6 : 1.0, 2.0, along ? 1.0 : 0.6, 0x1f262c, k2.x, 0, k2.z); rack.material.emissive = new THREE.Color(0x0a2a14); }
    } else if (t === 'electric' || t === 'tech') {
      for (var e2 = 0; e2 < Math.floor(span / 1.0); e2++) { var q = UV(-span / 2 + 0.6 + e2, 0.3); box(g, along ? 0.8 : 0.4, 1.9, along ? 0.4 : 0.8, t === 'electric' ? 0x9aa3a8 : 0x7a858c, q.x, 0, q.z); }
    } else if (t === 'wc') {
      var cab = Math.max(1, Math.floor((span - 1) / 1.0));
      for (var w = 0; w < cab; w++) { var pw = UV(-span / 2 + 0.6 + w * 1.0, depth - 0.8); box(g, along ? 0.05 : 1.4, 2.0, along ? 1.4 : 0.05, 0xb9c6cf, pw.x, 0, pw.z); var bowl = UV(-span / 2 + 1.1 + w * 1.0, depth - 0.5); box(g, 0.4, 0.42, 0.55, 0xffffff, bowl.x, 0, bowl.z); }
      for (var sk = 0; sk < 2; sk++) { var ps = UV(-span / 2 + 0.8 + sk * 0.8, 0.35); box(g, 0.55, 0.85, 0.45, 0xf4f6f7, ps.x, 0, ps.z); }
    } else if (t === 'smoking') {
      var bn = UV(0, depth - 0.4); box(g, along ? span - 1 : 0.45, 0.45, along ? 0.45 : span - 1, 0x8a6d4b, bn.x, 0, bn.z);
      var ash = UV(0, depth / 2); box(g, 0.35, 1.0, 0.35, 0x5b6670, ash.x, 0, ash.z);
      for (var sp = 0; sp < 5; sp++) seats.push(UV(-span / 2 + 0.6 + sp * (span - 1.2) / 4, depth - 0.9));
      var hood = UV(0, depth / 2); box(g, 1.2, 0.35, 1.2, 0xa0a8ae, hood.x, H - 0.4, hood.z);
    } else if (t === 'library') {
      for (var sh = 0; sh < 4; sh++) { var ps2 = UV(-span / 2 + 0.6, 1 + sh * (depth - 2) / 3); box(g, along ? 0.4 : 2.4, 2.0, along ? 2.4 : 0.4, 0x7a5a3a, ps2.x, 0, ps2.z); }
      rows(1.6, 0.8, 1.0, 2.5);
    } else if (t === 'service') { var ct = UV(0, 1.2); box(g, along ? span - 2 : 0.7, 1.05, along ? 0.7 : span - 2, 0xa77f54, ct.x, 0, ct.z); }
    else if (t === 'hall') { for (var hb = 0; hb < 3; hb++) { var ph = UV(-span / 3 + hb * span / 3, depth / 2); box(g, 1.6, 0.45, 0.5, 0x7f9aa8, ph.x, 0, ph.z); seats.push({ x: ph.x, z: ph.z + 0.6 }); } }
    else if (t === 'stairs') {
      for (var st = 0; st < 12; st++) box(g, along ? span * 0.4 : 0.3, 0.15 * (st + 1), along ? 0.3 : span * 0.4, 0xb0b6ba, along ? -span * 0.2 : -hw + 1 + st * 0.3, 0, along ? -hd + 1 + st * 0.3 : -span * 0.2);
    }
  }

  function buildPeople(g, n) {
    var pal = [0x4f7cac, 0xc0504d, 0x9bbb59, 0x8064a2, 0xf79646, 0x4bacc6];
    for (var i = 0; i < Math.min(n, seats.length); i++) {
      var s = seats[Math.floor(i * seats.length / Math.max(1, Math.min(n, seats.length)))] || seats[i];
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.0, 10), mat(pal[i % pal.length]));
      body.position.set(s.x, 0.5, s.z); g.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat(0xe8c4a0)); head.position.set(s.x, 1.15, s.z); g.add(head);
    }
  }

  function buildDevices(g, cg, now) {
    lightMeshes = []; pickables = [];
    var devs = REG.roomDevices(r), jb = W.jbox(r.id);
    devs.forEach(function (d) {
      var p = L(d.x, d.y, d.z), k = REG.KINDS[d.kind], col = REG.CATS[k.cat].color, body;
      if (d.kind === 'light') { body = box(g, 1.2, 0.05, 0.6, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 }), p.x, H - 0.06, p.z); lightMeshes.push({ m: body, d: d }); }
      else if (d.kind === 'board') { var bs = sideOf(d), bh = bs === 'S' || bs === 'N'; body = box(G.furniture, bh ? 2.4 : 0.08, 1.3, bh ? 0.08 : 2.4, 0x1b2228, p.x, 0.9, p.z); }
      else if (d.kind === 'hvac' || d.kind === 'exhaust') body = box(g, 0.9, 0.25, 0.9, 0xc9d1d6, p.x, H - 0.3, p.z);
      else body = box(g, 0.2, 0.2, 0.2, col, p.x, Math.min(H - 0.25, p.y - 0.1), p.z);
      body.userData.dev = d; pickables.push(body);
      var s = new THREE.Sprite(devTex(d.kind, SK.devices.state(d, now).status)); s.scale.set(0.42, 0.42, 1);
      s.position.set(p.x, Math.min(H + 0.25, p.y + 0.35), p.z); s.userData.dev = d; s.renderOrder = 15; g.add(s); pickables.push(s);
      /* Кабель: пристрій → під стелю → розподільча коробка */
      if (jb && d.conn && d.conn.length && d.conn[0].type !== 'WIFI') {
        var J = L(jb.x, jb.y, jb.z), c = W.BUS[d.conn[0].type].color, yC = H - 0.15 - (pickables.length % 5) * 0.03;
        var pts = [new THREE.Vector3(p.x, Math.min(p.y, H - 0.1), p.z), new THREE.Vector3(p.x, yC, p.z), new THREE.Vector3(J.x, yC, p.z), new THREE.Vector3(J.x, yC, J.z), new THREE.Vector3(J.x, J.y, J.z)];
        tube(cg, pts, c);
      }
    });
    if (jb) {
      var J2 = L(jb.x, jb.y, jb.z);
      box(cg, 0.3, 0.3, 0.12, 0x6b7780, J2.x, J2.y - 0.15, J2.z);
      var cab = REG.cabinet((devs[0] || {}).cabinet);
      var dd = jb.door, out = dd.nx ? new THREE.Vector3(J2.x + dd.nx * 2.5, J2.y, J2.z) : new THREE.Vector3(J2.x, J2.y, J2.z - (dd.ny || 0) * 2.5);
      tube(cg, [J2, out], 0x1b2830, 0.05);
      var lb = label('РК → ' + (cab ? cab.id : 'шафа') + ' (коридор)', 28); lb.position.set(out.x, out.y + 0.45, out.z); cg.add(lb);
    }
  }
  function tube(g, pts, color, rad) {
    var path = new THREE.CurvePath();
    for (var i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    if (!path.curves.length) return;
    var m = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 6, rad || 0.025, 6, false), new THREE.MeshBasicMaterial({ color: color }));
    g.add(m);
  }

  function buildBlinds(g, v) {
    var hasBlinds = REG.roomDevices(r).some(function (d) { return d.kind === 'blinds'; });
    if (!hasBlinds) return;
    var k = { open: 0.12, half: 0.5, closed: 1 }[v.params.blinds] || 0.12;
    G.windows.forEach(function (o) {
      var h = (o.hi - o.lo) * k, inset = 0.12;
      var off = o.side === 'S' ? -inset : o.side === 'N' ? inset : o.side === 'W' ? inset : -inset;
      var b = new THREE.Mesh(new THREE.BoxGeometry(o.horiz ? 1.7 : 0.03, h, o.horiz ? 0.03 : 1.7), mat(0xe8e2d0, 0.95));
      b.position.set(o.pos.x + (o.horiz ? 0 : off), o.hi - h / 2, o.pos.z + (o.horiz ? off : 0)); g.add(b);
    });
  }

  /* ---------- Відкриття ---------- */
  function clearGroup(g) { while (g && g.children.length) { var c = g.children.pop(); if (c.children && c.children.length) clearGroup(c); if (c.geometry) c.geometry.dispose(); } }
  function build() {
    ['shell', 'furniture', 'devices', 'cables', 'people', 'labels', 'model', 'blinds'].forEach(function (k) {
      if (G[k]) { clearGroup(G[k]); scene.remove(G[k]); }
      G[k] = new THREE.Group(); scene.add(G[k]);
    });
    G.windows = [];
    r = room; cx = (r.x0 + r.x1) / 2; cy = (r.y0 + r.y1) / 2; Wd = r.x1 - r.x0; Dp = r.y1 - r.y0; H = r.h - 0.2;
    var now = SK.store.clock.now(), v = SK.i3.read(r.id, now);
    var floorCol = { wc: 0xdfe6ea, server: 0x9aa3a8, electric: 0x9aa3a8, tech: 0xa8b0b5, hall: 0xd6d0c4, stairs: 0xc2c7ca, smoking: 0xb8ada0 }[r.type] || 0xc7a983;
    if (SK.theme && SK.theme.isDark()) floorCol = new THREE.Color(floorCol).multiplyScalar(0.45).getHex();
    box(G.shell, Wd, 0.1, Dp, floorCol, 0, -0.1, 0);
    var grid = new THREE.GridHelper(Math.max(Wd, Dp), Math.round(Math.max(Wd, Dp)), 0x9a8f80, 0xb8ad9c); grid.position.y = 0.002;
    grid.material.transparent = true; grid.material.opacity = 0.25; G.shell.add(grid);
    buildWalls(G.shell);
    buildFurniture(G.furniture);
    buildPeople(G.people, v.people);
    buildDevices(G.devices, G.cables, now);
    buildBlinds(G.blinds, v); G.blindsKey = v.params.blinds;
    var t = label(r.id + ' · ' + r.name, 34); t.position.set(0, H + 1.6, 0); t.scale.set(3.6, 0.68, 1); G.labels.add(t);
    var dims = label(U.fmt(Wd, 1) + ' × ' + U.fmt(Dp, 1) + ' м · h ' + U.fmt(r.h, 1) + ' м', 26); dims.position.set(0, H + 1.05, 0); dims.scale.set(2.6, 0.48, 1); G.labels.add(dims);
    pointLight.position.set(0, H - 0.3, 0);
    restoreModel();
    applyLayers(); updateLive();
  }
  function home() {
    var d = Math.max(Wd, Dp);
    camera.position.set(d * 0.75, d * 0.85 + 3, d * 0.95);
    controls.target.set(0, 1, 0); controls.update();
  }

  function applyLayers() {
    var hasModel = G.model && G.model.children.length > 0;
    G.furniture.visible = layers.furniture && !hasModel;
    G.people.visible = layers.people;
    G.devices.visible = layers.devices && canSee('devices');
    G.cables.visible = layers.cables && canSee('cables');
    G.labels.visible = layers.labels;
    var box2 = el.querySelector('#rmLayers');
    var items = [['furniture', 'Меблі'], ['people', 'Люди'], ['labels', 'Підписи']];
    if (canSee('devices')) items.push(['devices', 'Пристрої']);
    if (canSee('cables')) items.push(['cables', 'Кабелі']);
    box2.innerHTML = items.map(function (x) { return '<label><input type="checkbox" data-layer="' + x[0] + '"' + (layers[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join('');
  }

  function updateLive() {
    if (!room) return;
    var now = SK.store.clock.now(), v = SK.i3.read(room.id, now);
    lightMeshes.forEach(function (l) { l.m.material.emissive.setRGB(v.lightLevel, v.lightLevel * 0.95, v.lightLevel * 0.8); });
    pointLight.intensity = 0.15 + v.lightLevel * 0.9;
    var pc = G.people ? G.people.children.length / 2 : 0;
    if (Math.round(pc) !== Math.min(v.people, seats.length)) { clearGroup(G.people); buildPeople(G.people, v.people); }
    if (G.blindsKey !== v.params.blinds) { clearGroup(G.blinds); buildBlinds(G.blinds, v); G.blindsKey = v.params.blinds; }
    G.devices.children.forEach(function (o) {
      if (o.isSprite && o.userData.dev) { o.material = devTex(o.userData.dev.kind, SK.devices.state(o.userData.dev, now).status); var k = o.userData.dev === selDev ? 0.7 : 0.42; o.scale.set(k, k, 1); }
    });
    renderSide();
  }
  function highlight() { updateLive(); }

  /* ---------- Бічна панель ---------- */
  function renderSide() {
    var ae = document.activeElement; if (ae && side.contains(ae) && ae.tagName === 'SELECT') return;
    var now = SK.store.clock.now(), v = SK.i3.read(room.id, now), devs = REG.roomDevices(room), rl = role();
    var h = '<h2>' + esc(room.id) + '</h2><div class="small muted">' + esc(room.name) + ' · ' + esc(B.blockById(room.block).name) + ', поверх ' + room.floor +
      ' · ' + room.area + ' м²' + (room.capacity ? ' · ' + room.capacity + ' місць' : '') + '</div>';
    if (room.bookable) { var s = SK.schedule.status(room.id, now); h += '<div style="margin-top:6px"><span class="st ' + SK.schedule.STATUS[s.status].css + '">' + SK.schedule.STATUS[s.status].name + '</span>' + (s.lesson ? ' · ' + esc(s.lesson.subject) + ', ' + esc(s.lesson.group) : '') + '</div>'; }
    h += '<div class="metrics">' + m(v.temp + ' °C', 'Температура') + m(v.co2, 'CO₂, ppm') + m(v.people, 'Людей') +
      m(v.lightOn ? Math.round(v.lightLevel * 100) + ' %' : 'вимк.', 'Світло') + m(U.fmt(v.power / 1000, 2), 'кВт') + m(esc(v.scName), 'Сценарій') + '</div>';
    if (v.smoking) h += '<div class="small">Кімната для куріння: PM2.5 ' + v.pm25 + ' · витяжка ' + (v.smoking.exhaust ? 'працює' : 'черговий режим') + '</div>';
    h += '<div class="small muted">Жалюзі: ' + esc(SK.scenarios.PARAMS.blinds.opts[v.params.blinds]) + ' · правило «' + esc(v.rule) + '» <span class="demo-badge">симуляція</span></div>';
    if (selDev && canSee('devices')) {
      var ds = SK.devices.state(selDev, now);
      h += '<div class="card" style="margin-top:10px;box-shadow:none"><b>' + REG.KINDS[selDev.kind].icon + ' ' + esc(selDev.name) + '</b><div class="small">' + esc(ds.value || '') +
        ' · <span class="lvl ' + SK.devices.STATUS[ds.status].lvl + '">' + SK.devices.STATUS[ds.status].name + '</span></div>' +
        (canSee('ports') ? '<div class="small muted">' + (selDev.conn || []).map(function (c) { return esc((c.inst ? c.inst.id + ' · ' : '') + c.port + ' · ' + c.cable + (c.len ? ' ≈' + c.len + ' м' : '')); }).join('<br>') + '<br><code>' + esc(selDev.topic) + '</code></div>' : '') + '</div>';
    }
    if (canSee('devices')) {
      h += '<h3>Пристрої (' + devs.length + ')</h3><div class="small">' + devs.map(function (d) {
        var st = SK.devices.state(d, now);
        return '<a href="#" data-rdev="' + esc(d.id) + '"' + (d === selDev ? ' style="font-weight:700"' : '') + '>' + REG.KINDS[d.kind].icon + ' ' + esc(d.name) + '</a> — ' + esc(st.value || '') +
          (canSee('ports') && d.conn && d.conn[0] ? ' <span class="muted">[' + esc(d.conn[0].port) + ']</span>' : '');
      }).join('<br>') + '</div>';
    }
    if (canSee('cables')) {
      var links = W.forRoom(room.id), jb = W.jbox(room.id), byBus = {};
      links.forEach(function (l) { byBus[l.type] = (byBus[l.type] || 0) + 1; });
      h += '<h3>Комутація</h3><div class="small">Розподільча коробка <b>' + esc(jb.id) + '</b> біля дверей → шафа <b>' + esc((devs[0] || {}).cabinet || '—') + '</b>.<br>' +
        Object.keys(byBus).map(function (k) { return '<span class="cat-dot" style="background:' + W.BUS[k].css + '"></span>' + esc(W.BUS[k].name) + ': ' + byBus[k]; }).join('<br>') +
        '<br>Кабелю всього ≈ ' + links.reduce(function (a, l) { return a + l.len; }, 0) + ' м</div>';
    }
    if (canSee('model')) {
      h += '<h3>Окрема модель кімнати</h3><div class="small muted">Свою модель (.glb, 1 од. = 1 м) буде автоматично вписано в габарити приміщення; пристрої й кабелі лишаються поверх неї.</div>' +
        '<div class="row" style="margin-top:6px"><label class="btn small">⬆ .glb для ' + esc(room.id) + '<input type="file" id="rmFile" accept=".glb,.gltf" hidden></label>' +
        (G.model && G.model.children.length ? '<button class="btn small danger" id="rmModelDel">Прибрати</button>' : '') + '</div>';
    } else if (rl === 'guest') h += '<div class="small muted" style="margin-top:10px">Технічні подробиці (пристрої, комутація) доступні відповідальним особам і адміністратору.</div>';
    side.innerHTML = h;
  }
  function m(v, l) { return '<div class="metric"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function onSideClick(e) {
    var a = e.target.closest('[data-rdev]');
    if (a) { e.preventDefault(); selDev = REG.device(a.dataset.rdev); highlight(); var p = L(selDev.x, selDev.y, selDev.z); controls.target.copy(p); return; }
    if (e.target.id === 'rmModelDel') { idb('delete', room.id); clearGroup(G.model); applyLayers(); renderSide(); }
  }
  function onSideChange(e) {
    if (e.target.id !== 'rmFile' || !e.target.files[0]) return;
    var f = e.target.files[0], rd = new FileReader(), id = room.id;
    rd.onload = function () { loadModel(rd.result).then(function () { idb('put', id, rd.result); U.toast('Модель приміщення ' + id + ' збережено', 'good'); }).catch(function (err) { U.toast('Не вдалося відкрити модель: ' + err, 'bad'); }); };
    rd.readAsArrayBuffer(f);
  }

  /* ---------- Окрема .glb-модель кімнати ---------- */
  function idb(op, key, val) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('sk9-room-models', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('rooms'); };
        rq.onsuccess = function () {
          var tx = rq.result.transaction('rooms', op === 'get' ? 'readonly' : 'readwrite').objectStore('rooms');
          var q = op === 'get' ? tx.get(key) : op === 'put' ? tx.put(val, key) : tx.delete(key);
          q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); };
        };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function loadModel(buf) {
    return new Promise(function (resolve, reject) {
      new THREE.GLTFLoader().parse(buf, '', function (gltf) {
        clearGroup(G.model);
        var obj = gltf.scene, bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
        var k = Math.min(Wd / Math.max(size.x, 0.01), Dp / Math.max(size.z, 0.01), H / Math.max(size.y, 0.01));
        obj.position.set(-c.x * k, -bb.min.y * k, -c.z * k); obj.scale.setScalar(k);
        G.model.add(obj); applyLayers(); renderSide(); resolve();
      }, reject);
    });
  }
  function restoreModel() {
    var id = room.id;
    idb('get', id).then(function (buf) {
      if (buf && room && room.id === id) return loadModel(buf);
      if (location.protocol.indexOf('http') === 0) return fetch('assets/models/rooms/' + encodeURIComponent(id) + '.glb').then(function (r2) { if (!r2.ok) throw 0; return r2.arrayBuffer(); }).then(loadModel).catch(function () { });
    });
  }

  /* ---------- Цикл ---------- */
  var tick = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    var dir = camera.position.clone().sub(controls.target); dir.y = 0;
    walls.forEach(function (w) { var cut = w.normal.dot(dir) > 0; w.full.visible = !cut; w.low.visible = cut; });
    if (++tick % 120 === 0) updateLive();
    controls.update(); renderer.render(scene, camera);
  }

  function step(dir) {
    var list = B.rooms.filter(function (x) { return x.block === room.block && x.floor === room.floor; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var i = list.indexOf(room);
    open(list[(i + dir + list.length) % list.length].id);
    if (SK.dashboard && SK.dashboard.viewer) SK.dashboard.viewer.select(room.id);
  }

  function open(id) {
    if (SK.store.state.role === 'guest') { U.toast('Модель кімнати доступна відповідальним особам і адміністратору', 'warn'); return; }
    ensure();
    room = B.room(id); if (!room) return;
    selDev = null;
    el.hidden = false;
    el.querySelector('#rmTitle').textContent = 'Модель приміщення ' + room.id;
    el.querySelector('#rmSub').textContent = room.name + ' · ' + B.blockById(room.block).name + ', поверх ' + room.floor;
    resize(); build(); home();
    if (!raf) loop();
  }
  if (SK.theme) SK.theme.on(function () { if (room) { var keep = selDev; build(); selDev = keep; } });
  function close() { if (!el) return; el.hidden = true; if (raf) cancelAnimationFrame(raf); raf = null; room = null; }

  return { open: open, close: close, isOpen: function () { return !!room; }, current: function () { return room; } };
})();
