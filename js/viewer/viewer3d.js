/* Інтерактивна 3D-карта корпусу (ТЗ п. 3.1).
 *
 * - будує процедурну схему з SK.building (блоки, поверхи, аудиторії);
 * - фарбує аудиторії за обраним показником (колбек colorFor);
 * - фільтр поверхів, вибір аудиторії кліком, підказка при наведенні;
 * - маршрут «Як дійти» від головного входу;
 * - ІМПОРТ ГОТОВОЇ 3D-МОДЕЛІ (.glb/.gltf): модель додається поверх схеми,
 *   її можна масштабувати/обертати/зсувати; якщо меші названо за номерами
 *   аудиторій (напр. «А-301» або «room_A-301»), вони стають клікабельними
 *   та фарбуються за статусом. Модель зберігається в IndexedDB браузера.
 *
 * Залежності: vendor/three/three.min.js, OrbitControls.js, GLTFLoader.js (r128).
 */
SK.Viewer = function (container, opts) {
  opts = opts || {};
  var B = SK.building, U = SK.util;
  var self = this;
  var allLabels = [];   // усі підписи — для перемальовування при зміні теми

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'viewer-canvas';

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1000);
  var HOME = { pos: new THREE.Vector3(92, 88, 82), target: new THREE.Vector3(6, 2, -22) };
  camera.position.copy(HOME.pos);
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.minDistance = 15; controls.maxDistance = 320;
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.update();

  var hemi = new THREE.HemisphereLight(0xffffff, 0xb8c4cc, 0.95); scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.position.set(-60, 120, 80); scene.add(sun);
  var fill = new THREE.DirectionalLight(0xffffff, 0.2); fill.position.set(80, 60, -60); scene.add(fill);

  /* Земля та сітка 10 м */
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), new THREE.MeshLambertMaterial({ color: 0xe9eeea }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, -27); scene.add(ground);
  var grid = new THREE.GridHelper(200, 20, 0xc9d2d8, 0xd8dfe3); grid.position.set(0, 0, -27);
  grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);

  var root = new THREE.Group(); scene.add(root);           // процедурна схема
  var modelGroup = new THREE.Group(); scene.add(modelGroup); // імпортована модель
  var routeGroup = new THREE.Group(); scene.add(routeGroup);

  /* ---------- Побудова схеми ---------- */
  var shells = [], roomMeshes = {}, labelSprites = {}, blockLabels = [], slabs = [];
  var edgeMat = new THREE.LineBasicMaterial({ color: 0x33424c, transparent: true, opacity: 0.55 });

  function prism(pts, h, y0, mat) {
    var sh = new THREE.Shape(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }));
    var g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    var m = new THREE.Mesh(g, mat); m.position.y = y0;
    var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat); e.position.y = y0;
    var grp = new THREE.Group(); grp.add(m); grp.add(e);
    return grp;
  }

  B.blocks.forEach(function (b) {
    var total = b.floors * b.floorH;
    var mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    var s = prism(b.footprint, total, b.base, mat);
    s.userData = { block: b.id };
    root.add(s); shells.push(s);
    if (b.roof) {
      var rm = new THREE.MeshLambertMaterial({ color: b.roof.color, transparent: true, opacity: 0.35, depthWrite: false });
      var roof = prism(b.footprint, b.roof.h, b.base + total, rm);
      roof.userData = { roof: true, block: b.id };
      root.add(roof); shells.push(roof);
    }
    /* Перекриття поверхів */
    for (var f = 0; f < b.floors; f++) {
      var slab = prism(b.footprint, 0.2, b.base + f * b.floorH - 0.2,
        new THREE.MeshLambertMaterial({ color: 0xaab4ba, transparent: true, opacity: 0.5 }));
      slab.userData = { floor: b.levelFloor != null ? b.levelFloor : f, block: b.id };
      root.add(slab); slabs.push(slab);
    }
    if (b.pilotis) {
      var colGeo = new THREE.CylinderGeometry(0.35, 0.35, b.base, 10), colMat = new THREE.MeshLambertMaterial({ color: 0x8a949b });
      [-13, -8, -3, 1.5].forEach(function (x) {
        [10.9, 21.1].forEach(function (y) {
          var c = new THREE.Mesh(colGeo, colMat); c.position.set(x, b.base / 2, -y); root.add(c);
        });
      });
    }
    var lab = makeLabel(b.name, 34, true);
    var cx = 0, cy = 0;
    b.footprint.forEach(function (p) { cx += p[0]; cy += p[1]; });
    lab.position.set(cx / b.footprint.length, b.base + total + (b.roof ? b.roof.h : 0) + 4, -cy / b.footprint.length);
    lab.scale.set(14, 3.5, 1);
    root.add(lab); blockLabels.push(lab);
  });

  B.corridors.forEach(function (c) {
    var b = B.blockById(c.block);
    var g = new THREE.BoxGeometry(c.x1 - c.x0 - 0.3, 0.12, c.y1 - c.y0 - 0.3);
    var m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xe9ecee }));
    m.position.set((c.x0 + c.x1) / 2, b.base + c.floor * b.floorH + 0.06, -(c.y0 + c.y1) / 2);
    m.userData = { floor: c.floor, corridor: true };
    root.add(m); slabs.push(m);
  });

  B.rooms.forEach(function (r) {
    var inset = 0.25, gap = 0.45;
    var h = r.h - gap;
    var g = new THREE.BoxGeometry(r.x1 - r.x0 - inset * 2, h, r.y1 - r.y0 - inset * 2);
    var mat = new THREE.MeshLambertMaterial({ color: 0xcccccc, transparent: true, opacity: 0.92 });
    var m = new THREE.Mesh(g, mat);
    m.position.set((r.x0 + r.x1) / 2, r.z0 + h / 2 + 0.05, -(r.y0 + r.y1) / 2);
    m.userData = { room: r.id };
    var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    m.add(e);
    m.userData.edges = e;
    root.add(m);
    roomMeshes[r.id] = { mesh: m, room: r, extra: [] };
    m.userData.baseY = m.position.y;
    /* Підписи — для всіх приміщень (аудиторії, службові, санвузли, сходи…) */
    {
      var small = Math.min(r.x1 - r.x0, r.y1 - r.y0) < 5;
      var l = makeLabel(r.id, 30, false);
      l.position.set(m.position.x, r.z0 + r.h + 0.8, m.position.z);
      l.scale.set(small ? 3.6 : 5.2, small ? 0.9 : 1.3, 1);
      l.userData = { baseY: l.position.y, floor: r.floor, room: r.id, sx: l.scale.x, sy: l.scale.y };
      l.visible = false;
      root.add(l); labelSprites[r.id] = l;
    }
  });


  function dark() { return SK.theme ? SK.theme.isDark() : false; }
  function paintLabel(c, text, px, strong) {
    var g = c.getContext('2d'), dk = dark();
    g.clearRect(0, 0, c.width, c.height);
    g.font = 'bold ' + px + 'px Arial';
    while (g.measureText(text).width > 232 && px > 12) { px -= 2; g.font = 'bold ' + px + 'px Arial'; }   // довгий текст — менший шрифт
    g.fillStyle = dk ? (strong ? 'rgba(16,19,22,.95)' : 'rgba(16,19,22,.88)') : (strong ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.88)');
    roundRect(g, 2, 2, 252, 60, 12); g.fill();
    g.strokeStyle = dk ? '#5a666e' : '#33424c'; g.lineWidth = strong ? 3 : 2; roundRect(g, 2, 2, 252, 60, 12); g.stroke();
    g.fillStyle = dk ? '#e6ebee' : '#1c2a33'; g.font = 'bold ' + px + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
  }
  function makeLabel(text, px, strong) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64;
    paintLabel(c, text, px, strong);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.renderOrder = 10;
    s._lbl = { c: c, text: text, px: px, strong: strong, tex: tex }; allLabels.push(s);
    return s;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /* ---------- Територія: парковки, зона відпочинку, місце для куріння ---------- */
  var terr = new THREE.Group(); scene.add(terr);
  var spotMeshes = [], zoneLabels = [];
  var TR = SK.territory;
  if (TR) {
    var flat = function (x0, x1, y0, y1, color, h, y) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h || 0.06, y1 - y0), new THREE.MeshLambertMaterial({ color: color }));
      m.position.set((x0 + x1) / 2, (y || 0) + (h || 0.06) / 2, -(y0 + y1) / 2); terr.add(m); return m;
    };
    TR.zones.forEach(function (z) {
      var col = z.kind === 'parking' ? 0xb9c0c5 : z.kind === 'rest' ? 0xb7d9ae : 0xd8cdb8;
      flat(z.x0, z.x1, z.y0, z.y1, col, 0.06);
      if (z.kind === 'smoke') {           // навіс: 4 стійки + дах
        [[z.x0, z.y0], [z.x1, z.y0], [z.x0, z.y1], [z.x1, z.y1]].forEach(function (p) {
          var post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x6b7780 }));
          post.position.set(p[0], 1.2, -p[1]); terr.add(post);
        });
        var roof = flat(z.x0 - 0.3, z.x1 + 0.3, z.y0 - 0.3, z.y1 + 0.3, 0x9aa5ad, 0.12, 2.4);
        roof.material.transparent = true; roof.material.opacity = 0.75;
      }
      var lab = makeLabel(z.kind === 'parking' ? z.id : z.kind === 'rest' ? 'Відпочинок' : z.kind === 'gen' ? 'ДГУ' : z.id, 30, false);
      lab.position.set((z.x0 + z.x1) / 2, z.kind === 'smoke' ? 4.6 : 2.2, -(z.y0 + z.y1) / 2); lab.scale.set(6.4, 1.6, 1);
      terr.add(lab); zoneLabels.push(lab);
    });
    TR.spots.forEach(function (s) {
      var m = flat(s.x0 + 0.15, s.x1 - 0.15, s.y0 + 0.15, s.y1 - 0.15, 0x8fd19e, 0.08, 0.06);
      m.userData.spot = s; spotMeshes.push(m);
      if (s.mgn) { var e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x1f6fb2 })); m.add(e); }
    });
    TR.trees.forEach(function (t) {
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
      trunk.position.set(t.x, 1.1, -t.y); terr.add(trunk);
      var crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), new THREE.MeshLambertMaterial({ color: 0x5f9e57 }));
      crown.position.set(t.x, 3, -t.y); terr.add(crown);
    });
    TR.benches.forEach(function (b) { flat(b.x - 1.75, b.x + 1.75, b.y - 0.4, b.y + 0.4, 0xa77f54, 0.45, 0.05); });
    TR.paths.forEach(function (pl) {
      for (var i = 1; i < pl.length; i++) {
        var a = pl[i - 1], b = pl[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        var seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 1.6), new THREE.MeshLambertMaterial({ color: 0xe6dcc8 }));
        seg.position.set((a.x + b.x) / 2, 0.03, -(a.y + b.y) / 2);
        seg.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
        terr.add(seg);
      }
    });
  }

  /* ---------- Шар «Розумні пристрої» ---------- */
  var devGroup = new THREE.Group(); scene.add(devGroup);
  var devSprites = [], devCats = null, texCache = {}, selectedDev = null;
  var REG = SK.devicesI3;
  function devTexture(kind, status) {
    var key = kind + '|' + status;
    if (texCache[key]) return texCache[key];
    var k = REG.KINDS[kind], cat = REG.CATS[k.cat];
    var c = document.createElement('canvas'); c.width = c.height = 96;
    var g = c.getContext('2d');
    /* Кільце — завжди колір категорії; стан — окремий значок, щоб категорію не плутати з несправністю */
    g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2);
    g.fillStyle = status === 'alarm' ? '#ffd9d9' : status === 'idle' || status === 'off' ? '#e4e8eb' : '#ffffff'; g.fill();
    g.lineWidth = 7; g.strokeStyle = status === 'alarm' ? '#d23c3c' : cat.css; g.stroke();
    function badge(bg, txt, fg) { g.beginPath(); g.arc(76, 20, 17, 0, Math.PI * 2); g.fillStyle = bg; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
      g.fillStyle = fg || '#ffffff'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 76, 21); }
    if (status === 'active') { g.beginPath(); g.arc(78, 18, 10, 0, Math.PI * 2); g.fillStyle = '#2e9e5b'; g.fill(); }
    g.font = '44px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1b2830';
    g.globalAlpha = status === 'idle' ? 0.55 : 1;
    g.globalAlpha = status === 'idle' || status === 'off' ? 0.45 : 1;
    g.fillText(k.icon, 48, 52);
    g.globalAlpha = 1;
    if (status === 'fault') badge('#e2a21a', '!', '#1b2830');
    if (status === 'alarm') badge('#d23c3c', '!');
    if (status === 'off') {      // значок «вимкнено вручну» — намальована іконка живлення
      badge('#6b7780', '');
      g.strokeStyle = '#ffffff'; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.arc(76, 22, 8, -Math.PI * 0.32, Math.PI * 1.32); g.stroke();
      g.beginPath(); g.moveTo(76, 10); g.lineTo(76, 21); g.stroke();
    }
    var tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    texCache[key] = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    return texCache[key];
  }
  if (REG) REG.devices.forEach(function (d) {
    var s = new THREE.Sprite(devTexture(d.kind, 'ok'));
    s.position.set(d.x, d.z + 0.35, -d.y);
    var sz = d.block === 'T' ? 1.9 : 1.15; s.scale.set(sz, sz, 1); s.userData = { device: d, size: sz };
    s.renderOrder = 8; s.visible = false;
    devGroup.add(s); devSprites.push(s);
  });

  /* ---------- Стан відображення ---------- */
  var floor = null, selected = null, hovered = null, alarms = {};
  var showRooms = true, isolated = null, exploded = false, labelsAll = false, EXP = 6, plan = false, labelsNear = true;
  /* Компас: стрілка «Пн» обертається разом із камерою */
  var compass = document.createElement('div'); compass.className = 'v-compass'; compass.title = 'Північ';
  compass.innerHTML = '<span>Пн</span>'; container.appendChild(compass);
  function yOff(f) { return exploded ? (f || 0) * EXP : 0; }

  function applyVisibility() {
    Object.keys(roomMeshes).forEach(function (id) {
      var rm = roomMeshes[id], r = rm.room;
      /* Обраний поверх — яскраво; поверхи нижче — ледь помітно (контекст), вище — приховано */
      var ghost = floor !== null && r.floor < floor && !plan && !exploded;
      var vis = showRooms && (floor === null || r.floor === floor || ghost);
      rm.mesh.visible = vis; rm.mesh.userData.ghost = ghost;
      var op = ghost ? 0.07 : devCats ? (floor === null ? 0.22 : 0.4) : floor === null ? 0.92 : 0.97;
      if (isolated) op = id === isolated ? 0.97 : 0.06;
      rm.mesh.material.opacity = op;
      rm.mesh.material.depthWrite = !devCats && (!isolated || id === isolated);
      rm.mesh.userData.edges.material.opacity = isolated && id !== isolated ? 0.08 : 0.55;
      rm.mesh.position.y = rm.mesh.userData.baseY + yOff(r.floor);
      rm.extra.forEach(function (x) { x.visible = !isolated || id === isolated; });
      if (labelSprites[id]) {
        labelSprites[id].visible = vis && !ghost && labelsNear && (isolated ? id === isolated : floor !== null || labelsAll || exploded);
        labelSprites[id].position.y = labelSprites[id].userData.baseY + yOff(r.floor);
        var lk = plan ? 1.75 : 1; labelSprites[id].scale.set(labelSprites[id].userData.sx * lk, labelSprites[id].userData.sy * lk, 1);
      }
    });
    devSprites.forEach(function (s) {
      var d = s.userData.device;
      s.visible = !!devCats && devCats.indexOf(d.cat) >= 0 &&
        (d.block === 'T' ? (floor === null || floor === 0) : (floor === null || d.floor === floor));
    });
    slabs.forEach(function (s) {
      s.visible = floor === null ? (!s.userData.corridor || exploded) : s.userData.floor === floor;
      if (s.userData.baseY == null) s.userData.baseY = s.position.y;
      s.position.y = s.userData.baseY + yOff(s.userData.floor);
    });
    devSprites.forEach(function (s) { var d = s.userData.device; if (s.userData.baseY == null) s.userData.baseY = s.position.y; s.position.y = s.userData.baseY + (d.block === 'T' ? 0 : yOff(d.floor)); });
    if (isolated) devSprites.forEach(function (s) { if (s.userData.device.room !== isolated) s.visible = false; });
    shells.forEach(function (s) {
      var m = s.children[0].material;
      m.opacity = s.userData.roof ? (floor === null ? 0.35 : 0.06) : (floor === null ? 0.14 : 0.06);
      s.visible = !exploded && !model;
    });
    blockLabels.forEach(function (l) { l.visible = floor === null && !isolated; });
    /* Режим фокусу (вкладка «Комутація»): лише вибрані пристрої, їхні приміщення й траси */
    if (focus) {
      Object.keys(roomMeshes).forEach(function (id) {
        var rm = roomMeshes[id], on = !!focus.rooms[id];
        if (!rm.mesh.visible) return;
        rm.mesh.material.opacity = on ? 0.9 : 0.05;
        rm.mesh.material.depthWrite = false;
        rm.mesh.userData.edges.material.opacity = on ? 0.8 : 0.06;
        if (labelSprites[id]) labelSprites[id].visible = false;   // підписи дають позначки фокусу
      });
      devSprites.forEach(function (s) { s.visible = !!focus.devs[s.userData.device.id]; });
      blockLabels.forEach(function (l) { l.visible = false; });
      zoneLabels.forEach(function (l) { l.visible = false; });
    } else zoneLabels.forEach(function (l) { l.visible = true; });
  }

  var focus = null, focusGroup = new THREE.Group(); scene.add(focusGroup);
  function V(p) { return new THREE.Vector3(p.x, p.z, -p.y); }
  /* spec = {devices:[], rooms:[id], paths:[{pts:[{x,y,z}], color}], marks:[{x,y,z,text}], floor} ; null — вимкнути */
  this.setFocus = function (spec) {
    while (focusGroup.children.length) { var c = focusGroup.children.pop(); if (c.geometry) c.geometry.dispose(); }
    if (!spec) { focus = null; applyVisibility(); recolor(); return; }
    focus = { devs: {}, rooms: {} };
    (spec.devices || []).forEach(function (d) { focus.devs[d.id] = 1; });
    (spec.rooms || []).forEach(function (r) { focus.rooms[r] = 1; });
    isolated = null; exploded = false; clearRoute(); self.setWiring(null);
    if (spec.floor !== undefined) floor = spec.floor;
    var box3 = new THREE.Box3();
    (spec.paths || []).forEach(function (pth) {
      var pts = pth.pts.map(V), path = new THREE.CurvePath();
      for (var i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      if (!path.curves.length) return;
      var tubeM = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 10, pth.width || 0.16, 8, false),
        new THREE.MeshBasicMaterial({ color: pth.color, depthTest: false, transparent: true, opacity: 0.95 }));
      tubeM.renderOrder = 9; focusGroup.add(tubeM);
      pts.forEach(function (p) { box3.expandByPoint(p); });
      [pts[0], pts[pts.length - 1]].forEach(function (p) {
        var s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), new THREE.MeshBasicMaterial({ color: pth.color, depthTest: false }));
        s.position.copy(p); s.renderOrder = 10; focusGroup.add(s);
      });
    });
    (spec.marks || []).forEach(function (m) {
      var l = makeLabel(m.text, 26, true); l.position.copy(V(m)).add(new THREE.Vector3(0, m.dy != null ? m.dy : 1.6, 0)); l.scale.set(m.w || 5, (m.w || 5) / 4, 1);
      l.renderOrder = 12; focusGroup.add(l); box3.expandByPoint(V(m));
    });
    applyVisibility(); recolor();
    if (!box3.isEmpty()) {
      var c3 = box3.getCenter(new THREE.Vector3()), size = box3.getSize(new THREE.Vector3()).length();
      flyTo(c3, Math.max(48, Math.min(150, size * (spec.devices.length > 4 ? 1.4 : 2.2))));
    }
  };
  this.hasFocus = function () { return !!focus; };
  function pulseFocus(t) {
    if (!focus) return;
    devSprites.forEach(function (s) {
      if (!s.visible || !focus.devs[s.userData.device.id]) return;
      var k = s.userData.size * (1.6 + 0.35 * Math.sin(t * 5)); s.scale.set(k, k, 1);
    });
  }

  function recolor() {
    Object.keys(roomMeshes).forEach(function (id) {
      var rm = roomMeshes[id];
      var c = opts.colorFor ? opts.colorFor(rm.room) : 0xcccccc;
      if (c == null) c = 0xcccccc;
      rm.mesh.material.color.setHex(c);
      if (dark()) rm.mesh.material.color.multiplyScalar(0.72);   // чорна тема — без «засвіту»
      rm.extra.forEach(function (m) { if (m.material && m.material.color) m.material.color.setHex(c); });
      var a = opts.alarmFor ? opts.alarmFor(rm.room) : false;
      alarms[id] = a;
      if (!a) rm.mesh.material.emissive.setHex(0x000000);
    });
    if (opts.spotColor) spotMeshes.forEach(function (m) { m.material.color.setHex(opts.spotColor(m.userData.spot)); });
    refreshDevices();
    if (selected) markSelected(selected);
  }

  function refreshDevices() {
    if ((!devCats && !focus) || !opts.deviceState) return;
    devSprites.forEach(function (s) {
      if (!s.visible) return;
      var st = opts.deviceState(s.userData.device).status;
      s.material = devTexture(s.userData.device.kind, st);
      var k = s.userData.device === selectedDev ? 1.7 : 1;
      s.scale.set(s.userData.size * k, s.userData.size * k, 1);
      s.userData.status = st;
    });
  }

  var selBox = null;
  function markSelected(id) {
    if (selBox) { selBox.parent && selBox.parent.remove(selBox); selBox = null; }
    var rm = roomMeshes[id];
    if (!rm) return;
    var g = new THREE.EdgesGeometry(rm.mesh.geometry);
    selBox = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffb000, linewidth: 2 }));
    selBox.scale.set(1.04, 1.06, 1.04);
    rm.mesh.add(selBox);
  }

  /* ---------- Взаємодія ---------- */
  var ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), downAt = null;
  var tip = document.createElement('div'); tip.className = 'viewer-tip'; tip.hidden = true; container.appendChild(tip);

  function pickAt(ev) {
    var rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    if (devCats) {        // спершу — маркери пристроїв (найближчий до променя)
      var best = null, bd = 1e9;
      devSprites.forEach(function (s) {
        if (!s.visible) return;
        var p = s.position.clone().project(camera);
        if (p.z > 1) return;
        var dx = (p.x - mouse.x) * rect.width / 2, dy = (p.y - mouse.y) * rect.height / 2, dist = Math.hypot(dx, dy);
        var rad = Math.max(9, s.scale.x / s.position.distanceTo(camera.position) * rect.height * 0.9);
        if (dist < rad && dist < bd) { bd = dist; best = s; }
      });
      if (best) return { device: best.userData.device };
    }
    var targets = [];
    Object.keys(roomMeshes).forEach(function (id) {
      var rm = roomMeshes[id];
      if (rm.mesh.visible && !rm.mesh.userData.ghost) targets.push(rm.mesh);
      rm.extra.forEach(function (m) { if (m.visible) targets.push(m); });
    });
    var hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.room : null;
  }

  renderer.domElement.addEventListener('pointerdown', function (e) { downAt = { x: e.clientX, y: e.clientY }; });
  var lastHover = null;
  renderer.domElement.addEventListener('dblclick', function (e) {
    var id = pickAt(e);
    if (id && !id.device && opts.onOpenRoom) opts.onOpenRoom(B.room(id));
  });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!downAt || Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 6) return;
    var id = pickAt(e);
    if (id && id.device) { self.selectDevice(id.device, true); return; }
    self.select(id, true);
  });
  var lastMove = 0;
  renderer.domElement.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
    var id = pickAt(e);
    hovered = id;
    if (id) {
      var rect = container.getBoundingClientRect();
      if (id.device) tip.innerHTML = opts.deviceTip ? opts.deviceTip(id.device) : U.esc(id.device.name);
      else tip.innerHTML = opts.tipFor ? opts.tipFor(B.room(id)) : U.esc(id);
      tip.style.left = (e.clientX - rect.left + 14) + 'px';
      tip.style.top = (e.clientY - rect.top + 14) + 'px';
      tip.hidden = false;
      renderer.domElement.style.cursor = 'pointer';
    } else { tip.hidden = true; renderer.domElement.style.cursor = ''; }
  });
  renderer.domElement.addEventListener('pointerleave', function () { tip.hidden = true; });

  /* ---------- Маршрут «Як дійти» (орієнтовний) ---------- */
  function route(roomId) {
    clearRoute();
    var r = B.room(roomId); if (!r) return;
    var N = B.nav, pts = [], b = B.blockById(r.block);
    var fy = function (f) { return b.base + f * b.floorH + 0.6; };
    var P = function (x, y, z) { pts.push(new THREE.Vector3(x, z, -y)); };
    var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    P(N.entrance.x, N.entrance.y + 8, 0.6); P(N.entrance.x, N.entrance.y, 0.6);
    if (r.block === 'C') {
      P(-15, 16, 0.6); P(-17, 16, 0.6); P(-24.5, 16, 0.6); P(-24.5, -2, 0.6); P(-24.5, -7, 3.6 + 0.6); P(-24.5, 0, 3.6 + 0.6);
      P(-24.5, 16, 3.6 + 0.6); P(-15, 16, 3.6 + 0.6); P(cx, cy, 3.6 + 0.6);
    } else if (r.block === 'A') {
      P(N.A.door.x, N.A.door.y, 0.6); P(N.A.corridorX, N.A.door.y, 0.6);
      if (r.floor > 0) {
        var st = cy > 27 ? N.A.stairs[1] : N.A.stairs[0];
        var near = st.y < 0 ? -2 : 56;
        P(N.A.corridorX, near, 0.6); P(st.x, st.y, fy(r.floor)); P(N.A.corridorX, near, fy(r.floor));
      }
      var doorX = r.x1 <= -26 ? -26 : -23;
      if (r.type === 'stairs') doorX = N.A.corridorX;
      P(N.A.corridorX, cy, fy(r.floor)); P(doorX, cy, fy(r.floor)); P(cx, cy, fy(r.floor));
    } else {
      P(N.B.door.x - 4, N.B.door.y, 0.6); P(N.B.door.x, N.B.door.y, 0.6);
      if (r.floor > 0) {
        var s2 = N.B.stairs[0];
        P(s2.x, N.B.corridorY, 0.6); P(s2.x, s2.y, fy(r.floor)); P(s2.x, N.B.corridorY, fy(r.floor));
      }
      if (r.y0 >= 21) { P(cx, N.B.corridorY, fy(r.floor)); P(cx, 16.5, fy(r.floor)); P(cx, cy, fy(r.floor)); }
      else { P(cx, N.B.corridorY, fy(r.floor)); P(cx, cy, fy(r.floor)); }
    }
    var path = new THREE.CurvePath();
    for (var i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    var tube = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 12, 0.45, 8, false),
      new THREE.MeshBasicMaterial({ color: 0xff8a00, depthTest: false, transparent: true, opacity: 0.95 }));
    tube.renderOrder = 5;
    routeGroup.add(tube);
    var pin = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 16), new THREE.MeshBasicMaterial({ color: 0xff8a00, depthTest: false }));
    pin.rotation.x = Math.PI; pin.position.set(cx, r.z0 + r.h + 2.5, -cy); pin.renderOrder = 6;
    pin.userData.bob = true;
    routeGroup.add(pin);
    var start = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2e9e5b, depthTest: false }));
    start.position.copy(pts[0]); start.renderOrder = 6; routeGroup.add(start);
  }
  function clearRoute() {
    while (routeGroup.children.length) {
      var c = routeGroup.children.pop();
      c.geometry && c.geometry.dispose();
    }
  }

  /* ---------- Імпорт 3D-моделі ---------- */
  var model = null;
  var NAME_RE = /([АБПABP])\s*[-_ ]?\s*(\d{3}|\dС\d|\dC\d)/i;
  function normalizeName(n) {
    var m = NAME_RE.exec(n || '');
    if (!m) return null;
    var map = { A: 'А', B: 'Б', P: 'П', a: 'А', b: 'Б', p: 'П', 'а': 'А', 'б': 'Б', 'п': 'П' };
    var L = map[m[1]] || m[1].toUpperCase();
    return L + '-' + m[2].replace('C', 'С');
  }

  function loadModel(buffer, name, persist) {
    return new Promise(function (resolve, reject) {
      if (!THREE.GLTFLoader) return reject(new Error('GLTFLoader не завантажено'));
      var loader = new THREE.GLTFLoader();
      loader.parse(buffer, '', function (gltf) {
        clearModel(true);
        model = gltf.scene;
        var bound = 0;
        model.traverse(function (o) {
          if (!o.isMesh) return;
          var id = normalizeName(o.name) || normalizeName(o.parent && o.parent.name);
          if (id && roomMeshes[id]) {
            o.material = o.material.clone();
            o.userData.room = id;
            roomMeshes[id].extra.push(o);
            bound++;
          }
        });
        modelGroup.add(model);
        applyModelTransform();
        recolor();
        if (persist !== false) saveModelToDB(buffer, name);
        SK.store.emit('model', { loaded: true, name: name, bound: bound });
        resolve({ name: name, bound: bound });
      }, function (err) { reject(err); });
    });
  }

  function clearModel(keepDB) {
    if (model) {
      modelGroup.remove(model);
      Object.keys(roomMeshes).forEach(function (id) { roomMeshes[id].extra = []; });
      model = null;
    }
    if (!keepDB) { deleteModelFromDB(); SK.store.emit('model', { loaded: false }); }
  }

  function applyModelTransform() {
    var t = SK.store.state.settings.model;
    modelGroup.scale.setScalar(t.scale || 1);
    modelGroup.rotation.y = (t.rotY || 0) * Math.PI / 180;
    modelGroup.position.set(t.x || 0, t.y || 0, -(t.z || 0));
    showRooms = t.showRooms !== false || !model;
    shells.forEach(function (s) { s.visible = !model; });
    blockLabels.forEach(function (l) { l.visible = floor === null; });
    applyVisibility();
  }

  /* IndexedDB — щоб модель не довелося завантажувати після перезапуску */
  function db() {
    return new Promise(function (res, rej) {
      try {
        var req = indexedDB.open('sk9-models', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('models'); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      } catch (e) { rej(e); }
    });
  }
  function saveModelToDB(buf, name) {
    db().then(function (d) { d.transaction('models', 'readwrite').objectStore('models').put({ buf: buf, name: name }, 'main'); }).catch(function () { });
  }
  function deleteModelFromDB() {
    db().then(function (d) { d.transaction('models', 'readwrite').objectStore('models').delete('main'); }).catch(function () { });
  }
  function restoreModel() {
    return db().then(function (d) {
      return new Promise(function (res) {
        var rq = d.transaction('models').objectStore('models').get('main');
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      });
    }).then(function (rec) {
      if (rec && rec.buf) return loadModel(rec.buf, rec.name, false);
      /* Якщо сайт відкрито через http(s) — пробуємо типовий файл assets/models/korpus9.glb */
      if (location.protocol.indexOf('http') === 0 && opts.defaultModelUrl) {
        return fetch(opts.defaultModelUrl).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
          .then(function (b) { return loadModel(b, opts.defaultModelUrl, false); }).catch(function () { return null; });
      }
      return null;
    }).catch(function () { return null; });
  }

  /* ---------- Цикл рендерингу ---------- */
  function resize() {
    var w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  resize();

  var tween = null;
  var frame = 0;
  (function loop() {
    requestAnimationFrame(loop);
    var t = performance.now() / 1000;
    if (tween) {
      var k = Math.min(1, (performance.now() - tween.t0) / 700), e = k * (2 - k);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.c0, tween.c1, e);
      if (k >= 1) tween = null;
    }
    /* Підсвітка приміщення під курсором */
    if (lastHover && lastHover !== hovered && roomMeshes[lastHover] && !alarms[lastHover]) roomMeshes[lastHover].mesh.material.emissive.setHex(0);
    if (typeof hovered === 'string' && roomMeshes[hovered] && !alarms[hovered]) roomMeshes[hovered].mesh.material.emissive.setHex(0x2a3a48);
    lastHover = typeof hovered === 'string' ? hovered : null;
    Object.keys(alarms).forEach(function (id) {
      if (!alarms[id]) return;
      var v = 0.5 + 0.5 * Math.sin(t * 6);
      roomMeshes[id].mesh.material.emissive.setRGB(0.6 * v, 0, 0);
    });
    pulseFocus(t);
    routeGroup.children.forEach(function (c) { if (c.userData.bob) c.position.y += Math.sin(t * 3) * 0.02; });
    /* Компас і підписи: далеко — підписи ховаються, щоб не злипалися */
    if (++frame % 10 === 0) {
      compass.style.transform = 'rotate(' + (controls.getAzimuthalAngle() * 180 / Math.PI) + 'deg)';
      var near = plan || isolated || camera.position.distanceTo(controls.target) < 150;
      if (near !== labelsNear) { labelsNear = near; applyVisibility(); }
    }
    controls.update();
    renderer.render(scene, camera);
  })();

  function flyTo(target, dist) {
    var dir = camera.position.clone().sub(controls.target).normalize();
    tween = { t0: performance.now(), p0: camera.position.clone(), c0: controls.target.clone(),
      c1: target.clone(), p1: target.clone().add(dir.multiplyScalar(dist || 60)) };
  }

  /* ---------- Публічний API ---------- */
  /* Тема: чорна / світла — земля, сітка, світло, підписи */
  function applyTheme() {
    var dk = dark();
    ground.material.color.setHex(dk ? 0x030405 : 0xe9eeea);
    grid.material.color.setHex(dk ? 0x161b1f : 0xd8dfe3);
    hemi.intensity = dk ? 0.7 : 0.95; hemi.groundColor.setHex(dk ? 0x20262b : 0xb8c4cc); sun.intensity = dk ? 0.38 : 0.45;
    slabs.forEach(function (s) { if (s.material && s.material.color) s.material.color.setHex(dk ? 0x3a444b : 0xaab4ba); });
    /* Територія: у чорній темі світлі поверхні (доріжки, газон, майданчики) приглушуються */
    terr.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.color || o.userData.spot) return;
      if (o.userData.baseHex == null) o.userData.baseHex = o.material.color.getHex();
      o.material.color.setHex(o.userData.baseHex);
      if (dk) o.material.color.multiplyScalar(0.32);
    });
    recolor();
    allLabels = allLabels.filter(function (s) { return s.parent; });
    allLabels.forEach(function (s) { paintLabel(s._lbl.c, s._lbl.text, s._lbl.px, s._lbl.strong); s._lbl.tex.needsUpdate = true; });
  }
  if (SK.theme) SK.theme.on(applyTheme);
  applyTheme();
  this.setFloor = function (f, noFly) {
    floor = f; applyVisibility(); recolor();
    if (plan) planCamera();
    else if (f !== null && !noFly && !isolated) flyTo(new THREE.Vector3(controls.target.x, B.floorZ('A', f) + 1.5, controls.target.z), Math.min(130, camera.position.distanceTo(controls.target)));
  };
  /* Режим «План»: вигляд згори на обраний поверх, перетягування — зсув */
  function planCamera() {
    var z = (floor === null ? 1 : floor) * B.floorH + 1;
    tween = { t0: performance.now(), p0: camera.position.clone(), c0: controls.target.clone(),
      c1: new THREE.Vector3(2, z, -27), p1: new THREE.Vector3(2, z + 108, -26.9) };
  }
  this.setPlan = function (on) {
    plan = !!on;
    if (plan) {
      if (floor === null) floor = 1;
      controls.minPolarAngle = 0; controls.maxPolarAngle = 0.001;
      controls.minAzimuthAngle = 0; controls.maxAzimuthAngle = 0;
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.screenSpacePanning = true;
      planCamera();
    } else {
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI / 2.08;
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      self.home();
    }
    applyVisibility(); recolor();
    return floor;
  };
  this.isPlan = function () { return plan; };
  /* Режим виділення однієї кімнати: решта приміщень стає майже прозорою */
  this.isolate = function (id) {
    isolated = id || null;
    if (isolated) { var r = B.room(isolated); floor = r.floor; self.select(isolated); self.focusRoom(isolated); }
    applyVisibility(); recolor();
  };
  this.getIsolated = function () { return isolated; };
  /* «Розібрані» поверхи: кожен поверх піднято, щоб було видно всі */
  this.setExplode = function (on) { exploded = !!on; clearRoute(); self.setWiring(null); applyVisibility(); if (on) flyTo(new THREE.Vector3(0, 14, -24), 150); };
  this.setLabelsAll = function (on) { labelsAll = !!on; applyVisibility(); };
  /* Шар пристроїв: масив категорій (див. SK.devicesI3.CATS) або null — вимкнути */
  this.setDevices = function (cats) { devCats = cats && cats.length ? cats.slice() : null; applyVisibility(); recolor(); };
  this.getDevices = function () { return devCats; };
  /* Карта комутації: лінії від пристроїв до шафи (ортогональна траса, схематично).
     lines = [{a:{x,y,z}, b:{x,y,z}, color}] ; null — прибрати */
  var wireGroup = new THREE.Group(); scene.add(wireGroup);
  this.setWiring = function (lines) {
    while (wireGroup.children.length) { var c = wireGroup.children.pop(); c.geometry.dispose(); }
    if (!lines || !lines.length) return;
    var pos = [], col = [], tmp = new THREE.Color();
    lines.forEach(function (l, i) {
      var off = ((i % 7) - 3) * 0.08;              // розвести паралельні лінії
      var A = new THREE.Vector3(l.a.x, l.a.z, -l.a.y), Bp = new THREE.Vector3(l.b.x + off, l.b.z + off, -l.b.y);
      var M1 = new THREE.Vector3(A.x, Bp.y, A.z), M2 = new THREE.Vector3(A.x, Bp.y, Bp.z);
      [[A, M1], [M1, M2], [M2, Bp]].forEach(function (s) {
        pos.push(s[0].x, s[0].y, s[0].z, s[1].x, s[1].y, s[1].z);
        tmp.setHex(l.color); col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
      });
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    ls.renderOrder = 7; wireGroup.add(ls);
  };
  this.selectDevice = function (d, fromUser) {
    selectedDev = d || null;
    refreshDevices();
    if (opts.onDeviceSelect) opts.onDeviceSelect(selectedDev, fromUser);
  };
  this.focusDevice = function (d) {
    if (d.block !== 'T' && floor !== null && floor !== d.floor) self.setFloor(d.floor);
    flyTo(new THREE.Vector3(d.x, d.z, -d.y), d.block === 'T' ? 70 : 45);
  };
  this.getFloor = function () { return floor; };
  this.refresh = recolor;
  this.select = function (id, fromUser) {
    selected = id || null;
    if (selBox) { selBox.parent && selBox.parent.remove(selBox); selBox = null; }
    if (id) markSelected(id);
    if (opts.onSelect) opts.onSelect(id ? B.room(id) : null, fromUser);
  };
  this.focusRoom = function (id) {
    var r = B.room(id); if (!r) return;
    if (floor !== null && floor !== r.floor) self.setFloor(r.floor);
    flyTo(new THREE.Vector3((r.x0 + r.x1) / 2, r.z0 + 1, -(r.y0 + r.y1) / 2), 55);
  };
  this.home = function () {
    tween = { t0: performance.now(), p0: camera.position.clone(), c0: controls.target.clone(), p1: HOME.pos.clone(), c1: HOME.target.clone() };
  };
  this.route = route;
  this.clearRoute = clearRoute;
  this.loadModel = loadModel;
  this.clearModel = function () { clearModel(false); applyModelTransform(); };
  this.applyModelTransform = applyModelTransform;
  this.restoreModel = restoreModel;
  this.hasModel = function () { return !!model; };
  this.resize = resize;

  applyVisibility();
  recolor();
};
