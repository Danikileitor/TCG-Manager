// Escena 3D (WebGL) de la partida de prueba: una mesa inclinada con el campo, las pilas y la mano.
// Dibuja el estado de createPlaytest() y avisa de lo que hace el usuario (clic, doble clic, menú, arrastrar a una zona);
// la lógica y los botones son los mismos que en la mesa 2D (playtest.js).
import { el } from './ui.js';
import { mat, makeGenericBack } from './card-viewer.js';
import { loadCardImage, fitFor, placeholderCanvas } from './hand-sim.js';

const ASPECT = 63 / 88;
const FOV = (34 * Math.PI) / 180;
const TILT = (56 * Math.PI) / 180;
const PILE_ORDER = ['library', 'graveyard', 'exile', 'extra', 'security'];
const FIELD = { x0: -4.45, x1: 5.9, y0: -2.55, y1: 3.55 }; // rectángulo del campo en la mesa
const HAND = { x0: -4.45, x1: 5.9, y0: -4.25, y1: -2.75 };
const PILE_X = -5.75;
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const VERT = `attribute vec2 a_pos; attribute vec2 a_uv; uniform mat4 u_mvp; varying vec2 v_uv; varying vec2 v_pos;
void main(){ v_uv=a_uv; v_pos=a_pos; gl_Position=u_mvp*vec4(a_pos,0.0,1.0); }`;
const FRAG = `precision mediump float; varying vec2 v_uv; varying vec2 v_pos; uniform sampler2D u_tex; uniform float u_dim; uniform float u_mode; uniform vec2 u_half; uniform vec2 u_uv; uniform vec2 u_off; uniform vec4 u_color;
void main(){
  vec2 q=abs(v_pos)-(u_half-vec2(0.05)); float d=length(max(q,0.0))-0.05; float m=1.0-smoothstep(-0.010,-0.002,d);
  if(u_mode>1.5){ gl_FragColor=vec4(u_color.rgb*u_color.a,u_color.a); return; }
  if(u_mode>0.5){ gl_FragColor=vec4(0.0,0.0,0.0,0.38*m); return; }
  vec4 t=texture2D(u_tex,v_uv*u_uv+u_off); gl_FragColor=vec4(t.rgb*u_dim*m,t.a*m);
}`;

function invert(m) {
  // Gauss-Jordan sobre una matriz 4x4 en columnas
  const a = [];
  for (let r = 0; r < 4; r++) { a.push([m[r], m[4 + r], m[8 + r], m[12 + r], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]); }
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-9;
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const out = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r][4 + c];
  return out;
}
const apply = (m, v) => {
  const o = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
  return o;
};
const nonUniformScale = (sx, sy) => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const inPoly = (pts, px, py) => {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (cross !== 0) { if (sign && Math.sign(cross) !== sign) return false; sign = Math.sign(cross); }
  }
  return true;
};

export function createScene({ stage, pt, L, gameKey, getBackUrl, onMenu, onDouble, onPile, onDrop }) {
  const canvas = el('canvas', { class: 'pt3d-canvas', 'aria-label': 'Mesa de la partida de prueba' });
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true }) || canvas.getContext('webgl', { alpha: false, antialias: true });
  if (!gl) throw new Error('Este navegador no tiene WebGL');
  const tip = el('div', { class: 'pt3d-tip hidden' });
  stage.append(canvas, tip);

  const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader'); return sh; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('No se pudo preparar WebGL');
  gl.useProgram(prog);
  const loc = { pos: gl.getAttribLocation(prog, 'a_pos'), uv: gl.getAttribLocation(prog, 'a_uv') };
  const uni = Object.fromEntries(['u_mvp', 'u_tex', 'u_dim', 'u_mode', 'u_half', 'u_uv', 'u_off', 'u_color'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const a = ASPECT / 2;
  const mk = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; };
  const buffers = {
    front: mk([-a, -0.5, 0, 0, a, -0.5, 1, 0, a, 0.5, 1, 1, -a, -0.5, 0, 0, a, 0.5, 1, 1, -a, 0.5, 0, 1]),
    back: mk([-a, -0.5, 1, 0, a, 0.5, 0, 1, a, -0.5, 0, 0, -a, -0.5, 1, 0, -a, 0.5, 1, 1, a, 0.5, 0, 1]),
  };
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const textures = new Map();
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const texFor = (source) => {
    if (textures.has(source)) return textures.get(source);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isGL2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    textures.set(source, tex);
    return tex;
  };

  // ----- imágenes de las cartas (se cargan una vez por URL; mientras tanto se ve un marcador con el nombre) -----
  const fronts = new Map(); // url -> { src, fit }
  let back = { src: makeGenericBack(), fit: { x: 0, y: 0, w: 1, h: 1 } };
  const pending = new Set();
  const placeholders = new Map();
  const cachedPlaceholder = (card) => { const k = card.name; if (!placeholders.has(k)) placeholders.set(k, placeholderCanvas(card.name)); return placeholders.get(k); };
  function frontFor(card) {
    const url = card.imageUrl || '';
    if (fronts.has(url)) return fronts.get(url);
    if (!url) return { src: cachedPlaceholder(card), fit: { x: 0, y: 0, w: 1, h: 1 } };
    if (!pending.has(url)) {
      pending.add(url);
      loadCardImage(url).then((r) => fronts.set(url, r ? { src: r.img, fit: fitFor(r.img, r.cors) } : { src: cachedPlaceholder(card), fit: { x: 0, y: 0, w: 1, h: 1 } }));
    }
    return { src: cachedPlaceholder(card), fit: { x: 0, y: 0, w: 1, h: 1 }, temp: true };
  }
  (async () => {
    try {
      const url = await getBackUrl();
      const r = url ? await loadCardImage(url) : null;
      if (r) back = { src: r.img, fit: fitFor(r.img, false) };
    } catch (err) { /* se queda el dorso genérico */ }
  })();

  // ----- estado animado -----
  const anim = new Map(); // uid -> { cur, tgt }
  let items = []; // [{ uid, card, zone, tgt }] en orden de dibujo
  let piles = []; // [{ zone, count, x, y, top }]
  let drag = null; // { uid, x, y }
  let hoverKey = null;
  let W = 1;
  let H = 1;
  let alive = true;
  let pv = mat.identity();
  let quads = [];
  let zoneRects = [];

  function sync() {
    items = [];
    const push = (card, zone, tgt) => items.push({ uid: card.uid, card, zone, tgt: { x: 0, y: 0, z: 0.01, rx: 0, rz: 0, ry: card.faceDown ? Math.PI : 0, s: 1, dim: 1, ...tgt } });
    pt.zones.field.forEach((c, i) => push(c, 'field', { x: -3.85 + (i % 10) * 1.05, y: 2.85 - Math.floor(i / 10) * 1.2, z: 0.02, rz: c.tapped ? -Math.PI / 2 : 0 }));
    const n = pt.zones.hand.length;
    const step = Math.min(0.9, 9.6 / Math.max(1, n));
    pt.zones.hand.forEach((c, i) => push(c, 'hand', { x: 0.7 + (i - (n - 1) / 2) * step, y: -3.55, z: 0.45 + i * 0.002, rx: 0.62, s: 1.12 }));
    piles = PILE_ORDER.filter((z) => pt.zones[z]).map((zone, i) => {
      const list = pt.zones[zone];
      const top = list[list.length - 1];
      const showFace = (zone === 'graveyard' || zone === 'exile' || (zone === 'extra' && gameKey !== 'digimon' && gameKey !== 'ygo')) && top && !top.faceDown;
      return { zone, count: list.length, x: PILE_X, y: 3.0 - i * 1.3, top, showFace };
    });
    // Posición actual de las cartas nuevas: salen de la pila de la biblioteca
    for (const it of items) {
      if (!anim.has(it.uid)) anim.set(it.uid, { cur: { ...it.tgt, x: PILE_X, y: 3.0, z: 0.2, ry: Math.PI } });
      anim.get(it.uid).tgt = it.tgt;
    }
    const alive = new Set(items.map((i) => i.uid));
    for (const k of [...anim.keys()]) if (!alive.has(k)) anim.delete(k);
  }

  // ----- dibujo -----
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  function modelOf(c) {
    let m = mat.multiply(mat.rotateZ(c.rz), mat.multiply(mat.rotateY(c.ry), mat.scale(c.s)));
    m = mat.multiply(mat.rotateX(c.rx), m);
    return mat.multiply(mat.translate(c.x, c.y, c.z), m);
  }
  function drawQuad(side, mvp, tex, dim, mode, fit = { x: 0, y: 0, w: 1, h: 1 }, color = [0, 0, 0, 1]) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[side]);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(loc.uv);
    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uni.u_tex, 0);
    gl.uniform1f(uni.u_dim, dim);
    gl.uniform1f(uni.u_mode, mode);
    gl.uniform2f(uni.u_half, a, 0.5);
    gl.uniform2f(uni.u_uv, fit.w, fit.h);
    gl.uniform2f(uni.u_off, fit.x, 1 - fit.y - fit.h);
    gl.uniform4f(uni.u_color, color[0], color[1], color[2], color[3]);
    gl.uniformMatrix4fv(uni.u_mvp, false, new Float32Array(mvp));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  const rect = (x0, x1, y0, y1, z, color) => {
    const m = mat.multiply(mat.translate((x0 + x1) / 2, (y0 + y1) / 2, z), nonUniformScale((x1 - x0) / (2 * a), y1 - y0));
    drawQuad('front', mat.multiply(pv, m), null, 1, 2, undefined, color);
  };
  const project = (mvp, pts) => pts.map(([x, y]) => {
    const v = apply(mvp, [x, y, 0, 1]);
    return [((v[0] / v[3]) * 0.5 + 0.5) * W, (1 - ((v[1] / v[3]) * 0.5 + 0.5)) * H];
  });
  const rectPoly = (r, z = 0) => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => {
    const v = apply(pv, [x, y, z, 1]);
    return [((v[0] / v[3]) * 0.5 + 0.5) * W, (1 - ((v[1] / v[3]) * 0.5 + 0.5)) * H];
  });

  // Un punto de la pantalla -> punto de la mesa (plano z = 0)
  function unproject(px, py) {
    const inv = invert(pv);
    const nx = (px / W) * 2 - 1;
    const ny = 1 - (py / H) * 2;
    const p0 = apply(inv, [nx, ny, -1, 1]);
    const p1 = apply(inv, [nx, ny, 1, 1]);
    const a0 = p0.slice(0, 3).map((v) => v / p0[3]);
    const a1 = p1.slice(0, 3).map((v) => v / p1[3]);
    const t = a0[2] / (a0[2] - a1[2]);
    return { x: a0[0] + (a1[0] - a0[0]) * t, y: a0[1] + (a1[1] - a0[1]) * t };
  }

  function frame() {
    if (!alive) return;
    requestAnimationFrame(frame);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.05, 0.07, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const aspect = W / H;
    const half = Math.tan(FOV / 2);
    const dist = Math.max(7.3 / (half * aspect), 4.9 / half);
    pv = mat.multiply(mat.perspective(FOV, aspect, 0.1, 80), mat.multiply(mat.translate(0, -0.2, -dist), mat.rotateX(-TILT)));

    // Mesa y zonas
    rect(-6.8, 6.8, -4.7, 4.3, -0.01, [0.09, 0.15, 0.2, 1]);
    rect(FIELD.x0, FIELD.x1, FIELD.y0, FIELD.y1, -0.005, [1, 1, 1, 0.05]);
    rect(HAND.x0, HAND.x1, HAND.y0, HAND.y1, -0.005, [1, 1, 1, 0.04]);
    zoneRects = [];
    quads = [];
    const k = reduced() ? 1 : 0.22;

    // Pilas
    for (const p of piles) {
      rect(p.x - 0.42, p.x + 0.42, p.y - 0.58, p.y + 0.58, -0.004, [1, 1, 1, 0.07]);
      const layers = Math.min(6, Math.ceil(p.count / 8));
      const base = { x: p.x, y: p.y, rx: 0, rz: 0, s: 0.98, dim: 0.95 };
      for (let i = 0; i < layers; i++) {
        const c = { ...base, z: 0.005 + i * 0.03, ry: Math.PI };
        drawQuad('back', mat.multiply(pv, modelOf(c)), texFor(back.src), 0.9, 0, back.fit);
      }
      if (p.count > 0) {
        const c = { ...base, z: 0.005 + layers * 0.03, ry: p.showFace ? 0 : Math.PI };
        const mvp = mat.multiply(pv, modelOf(c));
        if (p.showFace) { const f = frontFor(p.top); drawQuad('front', mvp, texFor(f.src), 1, 0, f.fit); drawQuad('back', mvp, texFor(back.src), 1, 0, back.fit); } else drawQuad('back', mvp, texFor(back.src), 0.95, 0, back.fit);
      }
      const poly = project(mat.multiply(pv, modelOf({ ...base, z: 0.005, ry: 0 })), [[-a, -0.5], [a, -0.5], [a, 0.5], [-a, 0.5]]);
      zoneRects.push({ key: `pile:${p.zone}`, zone: p.zone, poly });
      quads.push({ key: `pile:${p.zone}`, pts: poly, z: -1 });
    }
    zoneRects.push({ key: 'zone:field', zone: 'field', poly: rectPoly(FIELD) });
    zoneRects.push({ key: 'zone:hand', zone: 'hand', poly: rectPoly(HAND, 0.3) });

    // Cartas (de la más lejana / baja a la más cercana, para que se tapen bien)
    const order = [...items].sort((p, q) => (p.tgt.z - q.tgt.z) || (q.tgt.y - p.tgt.y) || 0);
    for (const it of order) {
      const st = anim.get(it.uid);
      if (!st) continue;
      let tgt = { ...st.tgt };
      if (drag && drag.uid === it.uid) tgt = { ...tgt, x: drag.x, y: drag.y, z: 1.1, rx: 0.25, rz: 0, s: 1.15 };
      else if (hoverKey === it.uid) tgt = { ...tgt, z: tgt.z + 0.4, s: tgt.s * 1.12, rx: it.zone === 'hand' ? 0.9 : tgt.rx, y: it.zone === 'hand' ? tgt.y + 0.3 : tgt.y };
      for (const key of ['x', 'y', 'z', 'rx', 'rz', 'ry', 's']) st.cur[key] += (tgt[key] - st.cur[key]) * k;
      const c = st.cur;
      const model = modelOf(c);
      const mvp = mat.multiply(pv, model);
      drawQuad('front', mat.multiply(pv, mat.multiply(mat.translate(0.04, -0.05, -c.z + 0.002), model)), null, 1, 1);
      const f = frontFor(it.card);
      drawQuad('front', mvp, texFor(f.src), 1, 0, f.fit);
      drawQuad('back', mvp, texFor(back.src), 1, 0, back.fit);
      quads.push({ key: it.uid, pts: project(mvp, [[-a, -0.5], [a, -0.5], [a, 0.5], [-a, 0.5]]), z: c.z });
    }
  }

  // ----- ratón -----
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H }; };
  function hit(px, py) {
    for (const q of [...quads].reverse()) if (typeof q.key === 'number' && inPoly(q.pts, px, py)) return q.key;
    for (const q of quads) if (typeof q.key === 'string' && inPoly(q.pts, px, py)) return q.key;
    return null;
  }
  const zoneAt = (px, py) => {
    const hit2 = zoneRects.find((z) => inPoly(z.poly, px, py));
    return hit2 ? hit2.zone : null;
  };
  const lookup = (uid) => items.find((i) => i.uid === uid);

  let down = null;
  let lastTap = { uid: null, at: 0 };
  let menuTimer = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const { px, py } = pos(e);
    const key = hit(px, py);
    down = { key, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const { px, py } = pos(e);
    if (down && typeof down.key === 'number') {
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
      if (down.moved) { const w = unproject(px, py); drag = { uid: down.key, x: w.x, y: w.y }; }
    }
    const key = hit(px, py);
    hoverKey = typeof key === 'number' ? key : null;
    canvas.style.cursor = key === null ? 'default' : down && down.moved ? 'grabbing' : 'pointer';
    const it = hoverKey !== null ? lookup(hoverKey) : null;
    if (it && !it.card.faceDown && !drag) {
      tip.textContent = it.card.name;
      tip.style.left = `${e.clientX - canvas.getBoundingClientRect().left + 14}px`;
      tip.style.top = `${e.clientY - canvas.getBoundingClientRect().top + 14}px`;
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const { px, py } = pos(e);
    const d = down;
    down = null;
    if (d.moved && drag) {
      const zone = zoneAt(px, py);
      const uid = drag.uid;
      drag = null;
      if (zone) onDrop(uid, zone);
      return;
    }
    if (typeof d.key === 'string' && d.key.startsWith('pile:')) return onPile(d.key.slice(5));
    if (typeof d.key === 'number') {
      const it = lookup(d.key);
      if (!it) return;
      const now = performance.now();
      if (lastTap.uid === d.key && now - lastTap.at < 320) { clearTimeout(menuTimer); lastTap = { uid: null, at: 0 }; return onDouble(it.card, it.zone); }
      lastTap = { uid: d.key, at: now };
      clearTimeout(menuTimer);
      menuTimer = setTimeout(() => onMenu(it.card, it.zone, e.clientX, e.clientY), 330);
    }
  });
  canvas.addEventListener('pointerleave', () => { hoverKey = null; tip.classList.add('hidden'); });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { px, py } = pos(e);
    const key = hit(px, py);
    if (typeof key === 'number') { const it = lookup(key); if (it) onMenu(it.card, it.zone, e.clientX, e.clientY); }
  });

  sync();
  requestAnimationFrame(frame);
  return {
    sync,
    // Para pruebas: posición en pantalla (px de CSS) del centro de una carta o pila
    debugPoint(key) {
      const q = quads.find((x) => x.key === key);
      if (!q) return null;
      const r = canvas.getBoundingClientRect();
      const cx = q.pts.reduce((s, p) => s + p[0], 0) / 4;
      const cy = q.pts.reduce((s, p) => s + p[1], 0) / 4;
      return { x: r.left + (cx / W) * r.width, y: r.top + (cy / H) * r.height };
    },
    cardKeys: () => quads.filter((q) => typeof q.key === 'number').map((q) => q.key),
    zonePoint(zone) {
      const z = zoneRects.find((x) => x.zone === zone);
      if (!z) return null;
      const r = canvas.getBoundingClientRect();
      const cx = z.poly.reduce((s, p) => s + p[0], 0) / z.poly.length;
      const cy = z.poly.reduce((s, p) => s + p[1], 0) / z.poly.length;
      return { x: r.left + (cx / W) * r.width, y: r.top + (cy / H) * r.height };
    },
    dispose() {
      alive = false;
      clearTimeout(menuTimer);
      ro.disconnect();
      canvas.remove();
      tip.remove();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}
