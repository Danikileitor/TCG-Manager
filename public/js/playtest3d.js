// Escena 3D (WebGL) de la partida de prueba: una mesa inclinada con el campo, las pilas y la mano.
// Dibuja el estado de createPlaytest() y avisa de lo que hace el usuario (clic, doble clic, menú, arrastrar a una zona);
// la lógica y los botones son los mismos que en la mesa 2D (playtest.js).
import { el } from './ui.js';
import { mat, makeGenericBack } from './card-viewer.js';
import { loadCardImage, fitFor, placeholderCanvas } from './hand-sim.js';
import { layoutFor, areasOf, canStack, groupStacks } from './playtest-logic.js';

const ASPECT = 63 / 88;
const FOV = (34 * Math.PI) / 180;
const TILT = (28 * Math.PI) / 180; // inclinación suave: la mesa se ve casi de frente
const CW = 1.15; // tamaño de una celda de la rejilla del tablero (unidades de mesa; la carta mide ~0.72 x 1)
const CH = 1.42;
// Colores de la mesa de cada juego: [fondo de la escena, tapete, acento de zonas]
const THEMES = {
  mtg: { bg: [0.03, 0.07, 0.06], table: [0.07, 0.17, 0.13], accent: [0.45, 0.85, 0.6] },
  ygo: { bg: [0.06, 0.04, 0.09], table: [0.14, 0.1, 0.2], accent: [0.8, 0.6, 0.98] },
  digimon: { bg: [0.03, 0.06, 0.11], table: [0.07, 0.13, 0.24], accent: [0.45, 0.75, 1] },
  generic: { bg: [0.04, 0.06, 0.09], table: [0.09, 0.15, 0.2], accent: [0.65, 0.75, 0.85] },
};
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

  // ----- geometría del tablero de este juego (a partir de su rejilla) -----
  const layout = layoutFor(gameKey);
  const theme = THEMES[layout.theme] || THEMES.generic;
  const bw = layout.cols * CW;
  const bh = layout.rows * CH;
  const board = { x0: -bw / 2, x1: bw / 2, y0: -bh / 2, y1: bh / 2 };
  const HAND = { x0: board.x0, x1: board.x1, y0: board.y0 - 1.75, y1: board.y0 - 0.25 };
  const view = { top: board.y1 + 0.4, bottom: HAND.y0 - 0.1 };
  const cellRect = (c, r, w = 1, h = 1) => ({ x0: board.x0 + c * CW, x1: board.x0 + (c + w) * CW, y1: board.y1 - r * CH, y0: board.y1 - (r + h) * CH });
  const mid = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  // Destinos donde se puede soltar una carta, de más específico a menos
  const targets = [];
  const pileCells = [];
  const PEEK = 0.22; // cuánto asoma la carta de abajo en una pila de Digimon
  for (const cell of layout.cells) {
    if (cell.kind === 'pile') { if (pt.zones[cell.zone]) { const r = cellRect(cell.c, cell.r, 1, cell.h || 1); pileCells.push({ zone: cell.zone, rect: r, landscape: Boolean(cell.landscape) }); targets.push({ zone: cell.zone, rect: r }); } }
    else if (cell.kind === 'slots') cell.cells.forEach(([c, r], i) => targets.push({ zone: 'field', area: cell.area, slot: i, rect: cellRect(c, r) }));
    else targets.push({ zone: 'field', area: cell.area, rect: cellRect(cell.c, cell.r, cell.w, cell.h) });
  }
  targets.push({ zone: 'hand', rect: HAND });
  const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const areaCardPos = (card, i) => {
    const def = areasOf(gameKey).find((d) => d.area === card.area) || areasOf(gameKey)[0];
    if (def.kind === 'slots') { const [c, r] = def.cells[Math.min(card.slot || 0, def.cells.length - 1)]; return mid(cellRect(c, r)); }
    const per = def.w * def.h;
    const k = i % per;
    const p = mid(cellRect(def.c + (k % def.w), def.r + Math.floor(k / def.w)));
    const lap = Math.floor(i / per);
    return { x: p.x + lap * 0.09, y: p.y - lap * 0.09 };
  };

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

  function sync() {
    items = [];
    const push = (card, zone, tgt) => items.push({ uid: card.uid, card, zone, tgt: { x: 0, y: 0, z: 0.01, rx: 0, rz: 0, ry: card.faceDown ? Math.PI : 0, s: 1, dim: 1, ...tgt } });
    const counters = {};
    const place = (c, k, extra = {}) => {
      const p = areaCardPos(c, k);
      return { x: p.x, y: p.y, z: 0.02 + k * 0.001, rz: c.tapped ? -Math.PI / 2 : 0, ...extra };
    };
    if (canStack(gameKey)) {
      // Digimon: las cartas de una pila se escalonan para que asome la de abajo (su efecto heredado)
      groupStacks(pt.zones.field).forEach((st) => {
        const top = st[st.length - 1];
        const key = st[0].area || '';
        const k = counters[key] || 0;
        counters[key] = k + 1;
        st.forEach((c, idx) => {
          const d = st.length - 1 - idx;
          const t = place(top, k, { z: 0.02 + k * 0.012 + idx * 0.004 });
          const dx = top.tapped ? -d * PEEK : 0;
          const dy = top.tapped ? 0 : -d * PEEK;
          push(c, 'field', { ...t, x: t.x + dx, y: t.y + dy });
          items[items.length - 1].owner = top.uid;
          items[items.length - 1].d = d;
        });
      });
    } else {
      pt.zones.field.forEach((c) => {
        const key = c.area || '';
        const k = counters[key] || 0;
        counters[key] = k + 1;
        push(c, 'field', place(c, k));
      });
    }
    const n = pt.zones.hand.length;
    const step = Math.min(0.9, (bw - 1) / Math.max(1, n));
    const hy = mid(HAND).y - 0.05;
    pt.zones.hand.forEach((c, i) => push(c, 'hand', { x: (i - (n - 1) / 2) * step, y: hy, z: 0.45 + i * 0.002, rx: 0.5, s: 1.12 }));
    piles = pileCells.map(({ zone, rect, landscape }) => {
      const list = pt.zones[zone];
      const top = list[list.length - 1];
      const showFace = (zone === 'graveyard' || zone === 'exile' || (zone === 'extra' && gameKey !== 'digimon' && gameKey !== 'ygo')) && top && !top.faceDown;
      const m = mid(rect);
      return { zone, count: list.length, x: m.x, y: m.y + 0.12, top, showFace, rect, landscape };
    });
    const lib = piles.find((p) => p.zone === 'library') || { x: 0, y: 0 };
    // Posición actual de las cartas nuevas: salen de la pila de la biblioteca
    for (const it of items) {
      if (!anim.has(it.uid)) anim.set(it.uid, { cur: { ...it.tgt, x: lib.x, y: lib.y, z: 0.2, ry: Math.PI } });
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

  // Marco fino de una zona
  const outline = (r, color, t = 0.025) => {
    rect(r.x0, r.x1, r.y1 - t, r.y1, -0.004, color);
    rect(r.x0, r.x1, r.y0, r.y0 + t, -0.004, color);
    rect(r.x0, r.x0 + t, r.y0, r.y1, -0.004, color);
    rect(r.x1 - t, r.x1, r.y0, r.y1, -0.004, color);
  };
  const inset = (r, d) => ({ x0: r.x0 + d, x1: r.x1 - d, y0: r.y0 + d, y1: r.y1 - d });
  // Rótulos de texto (se dibujan una vez en un canvas y se usan como textura)
  const labels = new Map();
  const labelCanvas = (text) => {
    if (labels.has(text)) return labels.get(text);
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = '700 30px system-ui, sans-serif';
    g.font = font;
    c.width = Math.ceil(g.measureText(text).width) + 16;
    c.height = 44;
    g.font = font;
    g.fillStyle = 'rgba(240,244,252,0.9)';
    g.textBaseline = 'middle';
    g.fillText(text, 8, 24);
    labels.set(text, c);
    return c;
  };
  // Rótulo con tamaño de letra constante; align: 'left' (x = borde izquierdo) o 'center'
  const drawLabel = (text, x, y, align = 'left') => {
    const c = labelCanvas(text);
    const h = 0.17;
    const w = (h * c.width) / c.height;
    const cx = align === 'center' ? x : x + w / 2;
    const m = mat.multiply(mat.translate(cx, y, -0.002), nonUniformScale(w / (2 * a), h));
    drawQuad('front', mat.multiply(pv, m), texFor(c), 1, 0);
  };
  const rgba = (c, al) => [c[0], c[1], c[2], al];

  function frame() {
    if (!alive) return;
    requestAnimationFrame(frame);
    gl.viewport(0, 0, W, H);
    gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const aspect = W / H;
    const half = Math.tan(FOV / 2);
    // La cámara encuadra todo el tablero + la mano; con poca inclinación hace falta poca distancia
    const halfW = bw / 2 + 0.55;
    const halfH = (view.top - view.bottom) / 2;
    const dist = Math.max(halfW / (half * aspect), (halfH * Math.cos(TILT) + 0.5) / half) * 1.03 + halfH * Math.sin(TILT) * 0.45;
    const cy = (view.top + view.bottom) / 2;
    pv = mat.multiply(mat.perspective(FOV, aspect, 0.1, 80), mat.multiply(mat.translate(0, 0, -dist), mat.multiply(mat.rotateX(-TILT), mat.translate(0, -cy, 0))));

    // Mesa y zonas
    rect(board.x0 - 0.5, board.x1 + 0.5, HAND.y0 - 0.15, board.y1 + 0.3, -0.01, rgba(theme.table, 1));
    rect(HAND.x0, HAND.x1, HAND.y0, HAND.y1, -0.006, [0, 0, 0, 0.18]);
    outline(HAND, rgba(theme.accent, 0.25));
    drawLabel(`${L.hand} (${pt.zones.hand.length})`, HAND.x0 + 0.1, HAND.y1 - 0.14);
    for (const cell of layout.cells) {
      if (cell.kind !== 'frame') continue;
      const rc = inset(cellRect(cell.c, cell.r, cell.w, cell.h), 0.05);
      rect(rc.x0, rc.x1, rc.y0, rc.y1, -0.007, rgba(theme.accent, 0.05));
      outline(rc, rgba(theme.accent, 0.4));
      drawLabel(cell.label, rc.x1 - 0.1 - (labelCanvas(cell.label).width * 0.17) / labelCanvas(cell.label).height, rc.y1 - 0.13);
    }
    for (const cell of layout.cells) {
      if (cell.kind === 'slots') {
        cell.cells.forEach(([c, r], i) => {
          const rc = inset(cellRect(c, r), 0.05);
          rect(rc.x0, rc.x1, rc.y0, rc.y1, -0.006, rgba(theme.accent, 0.06));
          outline(rc, rgba(theme.accent, 0.5));
          if (i === 0 && cell.label) drawLabel(cell.label, rc.x0 + 0.06, rc.y1 - 0.13);
        });
      } else if (cell.kind === 'free') {
        const rc = inset(cellRect(cell.c, cell.r, cell.w, cell.h), 0.05);
        rect(rc.x0, rc.x1, rc.y0, rc.y1, -0.006, rgba(theme.accent, 0.045));
        outline(rc, rgba(theme.accent, 0.28));
        drawLabel(cell.label, rc.x0 + 0.08, rc.y1 - 0.13);
      }
    }
    quads = [];
    const k = reduced() ? 1 : 0.22;

    // Pilas
    for (const p of piles) {
      const pr = inset(p.rect, 0.05);
      rect(pr.x0, pr.x1, pr.y0, pr.y1, -0.006, rgba(theme.accent, 0.06));
      outline(pr, rgba(theme.accent, 0.4));
      drawLabel(`${L[p.zone] || p.zone} · ${p.count}`, (pr.x0 + pr.x1) / 2, pr.y0 + 0.13, 'center');
      if (p.landscape) {
        // Security: cartas boca abajo en horizontal, apiladas hacia abajo con el borde visible
        const n = Math.min(p.count, 9);
        for (let i = 0; i < n; i++) {
          const c = { x: (pr.x0 + pr.x1) / 2, y: pr.y1 - 0.6 - i * 0.3, z: 0.005 + i * 0.012, rx: 0, rz: Math.PI / 2, ry: Math.PI, s: 0.98, dim: 0.95 };
          drawQuad('back', mat.multiply(pv, modelOf(c)), texFor(back.src), 0.92, 0, back.fit);
        }
        const bottom = pr.y1 - 0.6 - Math.max(0, n - 1) * 0.3 - 0.4;
        quads.push({ key: `pile:${p.zone}`, pts: rectPoly({ x0: pr.x0, x1: pr.x1, y0: Math.max(bottom, pr.y0), y1: pr.y1 }, 0.05), z: -1 });
        continue;
      }
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
      quads.push({ key: `pile:${p.zone}`, pts: poly, z: -1 });
    }

    // Cartas (de la más lejana / baja a la más cercana, para que se tapen bien)
    const order = [...items].sort((p, q) => (p.tgt.z - q.tgt.z) || (q.tgt.y - p.tgt.y) || 0);
    for (const it of order) {
      const st = anim.get(it.uid);
      if (!st) continue;
      let tgt = { ...st.tgt };
      const own = it.owner ?? it.uid;
      if (drag && drag.uid === own) tgt = { ...tgt, x: drag.x, y: drag.y - (it.d || 0) * PEEK, z: 1.1 - (it.d || 0) * 0.01, rx: 0.25, rz: 0, s: 1.15 };
      else if (hoverKey === own) tgt = { ...tgt, z: tgt.z + 0.4, s: tgt.s * 1.12, rx: it.zone === 'hand' ? 0.9 : tgt.rx, y: it.zone === 'hand' ? tgt.y + 0.3 : tgt.y };
      for (const key of ['x', 'y', 'z', 'rx', 'rz', 'ry', 's']) st.cur[key] += (tgt[key] - st.cur[key]) * k;
      const c = st.cur;
      const model = modelOf(c);
      const mvp = mat.multiply(pv, model);
      drawQuad('front', mat.multiply(pv, mat.multiply(mat.translate(0.04, -0.05, -c.z + 0.002), model)), null, 1, 1);
      const f = frontFor(it.card);
      drawQuad('front', mvp, texFor(f.src), 1, 0, f.fit);
      drawQuad('back', mvp, texFor(back.src), 1, 0, back.fit);
      quads.push({ key: own, pts: project(mvp, [[-a, -0.5], [a, -0.5], [a, 0.5], [-a, 0.5]]), z: c.z });
    }
  }

  // ----- ratón -----
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H }; };
  function hit(px, py) {
    for (const q of [...quads].reverse()) if (typeof q.key === 'number' && inPoly(q.pts, px, py)) return q.key;
    for (const q of quads) if (typeof q.key === 'string' && inPoly(q.pts, px, py)) return q.key;
    return null;
  }
  // Destino bajo el puntero: { zone, area?, slot? } (se mira el punto sobre el plano de la mesa)
  const targetAt = (px, py) => {
    const w = unproject(px, py);
    if (canStack(gameKey)) {
      // Soltar sobre un Digimon (o el huevo) de la mesa: digievolución
      const over = items.find((i) => i.zone === 'field' && (i.owner ?? i.uid) === i.uid && (!drag || i.uid !== drag.uid) && Math.abs(w.x - i.tgt.x) <= (i.card.tapped ? 0.52 : 0.38) && Math.abs(w.y - i.tgt.y) <= (i.card.tapped ? 0.38 : 0.52));
      if (over) return { zone: 'field', area: over.card.area, slot: over.card.slot, onto: over.uid };
    }
    const t = targets.find((x) => inRect(x.rect, w.x, w.y));
    return t ? { zone: t.zone, area: t.area, slot: t.slot } : null;
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
      const target = targetAt(px, py);
      const uid = drag.uid;
      drag = null;
      if (target) onDrop(uid, target);
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
    // Centro en pantalla de un destino (zona, y opcionalmente área / hueco)
    zonePoint(zone, area, slot) {
      const z = targets.find((x) => x.zone === zone && (area === undefined || x.area === area) && (slot === undefined || x.slot === slot));
      if (!z) return null;
      const m = mid(z.rect);
      const p = project(pv, [[m.x, m.y]])[0];
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (p[0] / W) * r.width, y: r.top + (p[1] / H) * r.height };
    },
    targets: () => targets.map((t) => ({ zone: t.zone, area: t.area, slot: t.slot })),
    tilt: () => (TILT * 180) / Math.PI,
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
