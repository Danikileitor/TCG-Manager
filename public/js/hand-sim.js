// Simulador de mano inicial: reparte una mano del mazo abierto en una escena 3D (WebGL, o CSS 3D si el
// navegador no puede leer las imágenes en WebGL). Las reglas de cada TCG están en hand-logic.js.
import { el, clear, toast } from './ui.js';
import { createHandSim, rulesFor } from './hand-logic.js';
import { mat, findDefaultBack, makeGenericBack, openCardViewer } from './card-viewer.js';
import { viewerUrls } from './card-images.js';

const ASPECT = 63 / 88; // ancho / alto de una carta
const FOV = (30 * Math.PI) / 180;
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

// ---------------------------------------------------------------- imágenes
function loadImg(url, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => reject(new Error('timeout')), 12000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('error')); };
    img.src = url;
  });
}

const imageCache = new Map(); // url -> Promise<{ img, cors } | null>
// Devuelve la mejor imagen disponible: primero una legible por WebGL (CORS); si ninguna lo es, una cualquiera
function loadCardImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    imageCache.set(url, (async () => {
      const list = viewerUrls(url); // las mismas versiones, y en el mismo orden, que el visor 3D
      for (const u of list) {
        try { return { img: await loadImg(u, true), cors: true, src: u }; } catch (err) { /* siguiente */ }
      }
      for (const u of list) {
        try { return { img: await loadImg(u, false), cors: false, src: u }; } catch (err) { /* siguiente */ }
      }
      return null;
    })());
  }
  return imageCache.get(url);
}

// Proporción de una imagen (ancho / alto); la textura se ajusta a la carta en modo "cover" (sin recortar el marco,
// solo lo que sobre si la proporción de la imagen no es la de la carta)
const aspectOf = (src) => {
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  return w && h ? w / h : ASPECT;
};
// Escala de UV para que la imagen cubra toda la carta
function coverScale(imgAspect) {
  if (Math.abs(imgAspect - ASPECT) < 0.01) return [1, 1];
  return imgAspect > ASPECT ? [ASPECT / imgAspect, 1] : [1, imgAspect / ASPECT];
}

// Carta sin imagen: se dibuja el nombre
function placeholderCanvas(name) {
  const c = document.createElement('canvas');
  c.width = 366;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2130';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#6d7cff';
  g.lineWidth = 8;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#e8ecf4';
  g.font = 'bold 32px system-ui, sans-serif';
  g.textAlign = 'center';
  const words = String(name || '?').split(' ');
  let line = '';
  let y = 200;
  for (const w of words) {
    if (g.measureText(`${line} ${w}`).width > c.width - 60 && line) { g.fillText(line, c.width / 2, y); y += 40; line = w; } else line = `${line} ${w}`.trim();
  }
  g.fillText(line, c.width / 2, y);
  return c;
}

// ---------------------------------------------------------------- distribución en la mesa (unidades: alto de carta = 1)
// La mano ocupa una sola fila. La separación entre cartas se calcula para el tamaño de la mano inicial;
// las cartas que se roban después se añaden a la derecha y, si no caben, la mano se desplaza (abanico con scroll).
function computeLayout(aspect, n) {
  let visH = 2.3;
  let step = 0;
  if (n > 1) {
    step = Math.min(0.86, (visH * aspect * 0.9 - ASPECT) / (n - 1));
    if (step < 0.25) {
      step = 0.25;
      visH = ((n - 1) * 0.25 + ASPECT) / 0.9 / aspect;
    }
  }
  return { cols: n, visH, visW: visH * aspect, step };
}

const handStart = (L) => (-(L.cols - 1) * L.step) / 2;
// Desplazamiento máximo para que la última carta quede a la vista
const maxScroll = (L, n) => Math.max(0, handStart(L) + (n - 1) * L.step + ASPECT / 2 - L.visW * 0.47);

function slotTarget(i, L, scroll) {
  const x = handStart(L) + i * L.step - scroll;
  return { x, y: -0.22 - 0.016 * x * x, z: i * 0.01, ry: 0, rz: -0.035 * x, s: 1, dim: 1 };
}
const pileState = (L) => ({ x: L.visW / 2 - 0.5, y: L.visH / 2 - 0.62, z: 0.3, ry: Math.PI, rz: 0, s: 0.55, dim: 1 });

// ---------------------------------------------------------------- renderizador WebGL
const VERT = `attribute vec2 a_pos; attribute vec2 a_uv; uniform mat4 u_mvp; varying vec2 v_uv; varying vec2 v_pos;
void main(){ v_uv=a_uv; v_pos=a_pos; gl_Position=u_mvp*vec4(a_pos,0.0,1.0); }`;
const FRAG = `precision mediump float; varying vec2 v_uv; varying vec2 v_pos; uniform sampler2D u_tex; uniform float u_dim; uniform float u_mode; uniform vec2 u_half; uniform vec2 u_uv;
void main(){
  vec2 q=abs(v_pos)-(u_half-vec2(0.05)); float d=length(max(q,0.0))-0.05; float m=1.0-smoothstep(-0.010,-0.002,d);
  if(u_mode>0.5){ gl_FragColor=vec4(0.0,0.0,0.0,0.34*m); return; }
  vec4 t=texture2D(u_tex,(v_uv-0.5)*u_uv+0.5); gl_FragColor=vec4(t.rgb*u_dim*m,t.a*m);
}`;

function createGLRenderer(stage) {
  const canvas = el('canvas', { class: 'hs-canvas', 'aria-hidden': 'true' });
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true }) || canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) throw new Error('Este navegador no tiene WebGL');
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('No se pudo preparar WebGL');
  gl.useProgram(prog);
  const loc = { pos: gl.getAttribLocation(prog, 'a_pos'), uv: gl.getAttribLocation(prog, 'a_uv') };
  const uni = Object.fromEntries(['u_mvp', 'u_tex', 'u_dim', 'u_mode', 'u_half', 'u_uv'].map((n) => [n, gl.getUniformLocation(prog, n)]));

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
  gl.clearColor(0, 0, 0, 0);

  const textures = new Map(); // fuente (img | canvas) -> textura
  const texFor = (source) => {
    if (textures.has(source)) return textures.get(source);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // sin halo blanco en los bordes de los PNG con esquinas transparentes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isGL2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    textures.set(source, tex);
    return tex;
  };

  stage.append(canvas);
  let W = 1;
  let H = 1;
  let quads = [];

  function modelOf(c, dx = 0, dy = 0, dz = 0) {
    let m = mat.multiply(mat.rotateZ(c.rz), mat.multiply(mat.rotateY(c.ry), mat.scale(c.s)));
    m = mat.multiply(mat.translate(c.x + dx, c.y + dy, c.z + dz), m);
    return m;
  }
  function drawQuad(side, mvp, tex, dim, mode, uv = [1, 1]) {
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
    gl.uniform2f(uni.u_uv, uv[0], uv[1]);
    gl.uniformMatrix4fv(uni.u_mvp, false, new Float32Array(mvp));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  const shadow = (mvp) => { drawQuad('front', mvp, null, 1, 1); drawQuad('back', mvp, null, 1, 1); }; // se ve desde cualquier lado

  return {
    kind: 'webgl',
    canvas,
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W;
      canvas.height = H;
      return { w: r.width, h: r.height };
    },
    // frame: { visH, cards: [{ key, front, cur }], pile: { cur, count }, back }
    draw(frame) {
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const dist = frame.visH / 2 / Math.tan(FOV / 2);
      const pv = mat.multiply(mat.perspective(FOV, W / H, 0.1, 60), mat.translate(0, 0, -dist));
      const backTex = texFor(frame.back);
      const backUv = coverScale(aspectOf(frame.back));
      // Mazo: unas cuantas cartas apiladas
      const layers = Math.min(5, Math.ceil(frame.pile.count / 12));
      if (frame.pile.count > 0) {
        for (let i = layers - 1; i >= 0; i--) {
          const c = { ...frame.pile.cur, z: frame.pile.cur.z - i * 0.012, x: frame.pile.cur.x + i * 0.004, y: frame.pile.cur.y - i * 0.006 };
          if (i === layers - 1) shadow(mat.multiply(pv, modelOf(c, 0.02, -0.025, -0.003)));
          drawQuad('back', mat.multiply(pv, modelOf(c)), backTex, 0.95, 0, backUv);
        }
      }
      quads = [];
      const sorted = [...frame.cards].sort((p, q) => p.cur.z - q.cur.z);
      for (const card of sorted) {
        const model = modelOf(card.cur);
        const mvp = mat.multiply(pv, model);
        shadow(mat.multiply(pv, modelOf(card.cur, 0.035 * card.cur.s, -0.045 * card.cur.s, -0.004)));
        drawQuad('front', mvp, texFor(card.front), card.cur.dim, 0, coverScale(aspectOf(card.front)));
        drawQuad('back', mvp, backTex, card.cur.dim, 0, backUv);
        // esquinas en pantalla para detectar el ratón
        const pts = [[-a, -0.5], [a, -0.5], [a, 0.5], [-a, 0.5]].map(([x, y]) => {
          const v = mat.multiply(mat.multiply(pv, model), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]);
          const w = v[15];
          return [((v[12] / w) * 0.5 + 0.5) * W, (1 - ((v[13] / w) * 0.5 + 0.5)) * H];
        });
        quads.push({ key: card.key, pts, z: card.cur.z });
      }
    },
    hit(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const py = ((clientY - r.top) / r.height) * H;
      for (const q of [...quads].sort((p, o) => o.z - p.z)) {
        let sign = 0;
        let inside = true;
        for (let i = 0; i < 4; i++) {
          const [x1, y1] = q.pts[i];
          const [x2, y2] = q.pts[(i + 1) % 4];
          const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
          if (cross !== 0) { if (sign && Math.sign(cross) !== sign) { inside = false; break; } sign = Math.sign(cross); }
        }
        if (inside) return q.key;
      }
      return null;
    },
    dispose() {
      canvas.remove();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}

// ---------------------------------------------------------------- renderizador CSS 3D (plan B)
function createCssRenderer(stage) {
  const root = el('div', { class: 'hs-css' });
  stage.append(root);
  const els = new Map();
  let boxW = 1;
  let boxH = 1;
  let backSrc = '';
  const pile = el('div', { class: 'hs-card hs-pile' }, el('div', { class: 'hs-face hs-back' }));
  root.append(pile);
  return {
    kind: 'css',
    resize() {
      const r = root.getBoundingClientRect();
      boxW = r.width;
      boxH = r.height;
      return { w: r.width, h: r.height };
    },
    draw(frame) {
      const ppu = boxH / frame.visH;
      root.style.perspective = `${(frame.visH / 2 / Math.tan(FOV / 2)) * ppu}px`;
      const place = (node, c) => {
        node.style.width = `${ASPECT * ppu}px`;
        node.style.height = `${ppu}px`;
        node.style.marginLeft = `${(-ASPECT * ppu) / 2}px`;
        node.style.marginTop = `${-ppu / 2}px`;
        node.style.transform = `translate3d(${c.x * ppu}px, ${-c.y * ppu}px, ${c.z * ppu}px) rotateZ(${-c.rz}rad) rotateY(${c.ry}rad) scale(${c.s})`;
        node.style.zIndex = String(Math.round(c.z * 1000));
        node.style.setProperty('--dim', String(c.dim));
      };
      if (frame.backSrc !== backSrc) {
        backSrc = frame.backSrc;
        pile.firstChild.style.backgroundImage = `url("${backSrc}")`;
        for (const node of els.values()) node.lastChild.style.backgroundImage = `url("${backSrc}")`;
      }
      pile.style.display = frame.pile.count > 0 ? '' : 'none';
      place(pile, { ...frame.pile.cur, ry: 0 });
      const seen = new Set();
      for (const card of frame.cards) {
        seen.add(card.key);
        let node = els.get(card.key);
        if (!node) {
          node = el('div', { class: 'hs-card', dataset: { key: card.key } }, el('div', { class: 'hs-face hs-front' }), el('div', { class: 'hs-face hs-back' }));
          node.firstChild.style.backgroundImage = `url("${card.frontSrc}")`;
          node.lastChild.style.backgroundImage = `url("${backSrc}")`;
          root.append(node);
          els.set(card.key, node);
        }
        place(node, card.cur);
      }
      for (const [k, node] of els) if (!seen.has(k)) { node.remove(); els.delete(k); }
    },
    hit(clientX, clientY) {
      const node = document.elementsFromPoint(clientX, clientY).find((n) => n.classList && n.classList.contains('hs-card') && n.dataset.key);
      return node ? node.dataset.key : null;
    },
    dispose() { root.remove(); },
  };
}

// ---------------------------------------------------------------- diálogo y flujo
const RULE_TEXT = {
  mtg: 'Magic: 7 cartas. Mulligan de Londres: robas 7 cartas nuevas y pones al fondo del mazo tantas como mulligans hayas hecho.',
  ygo: 'Yu-Gi-Oh!: 5 cartas. No hay mulligan; "Nueva mano" baraja y reparte otra vez para practicar.',
  digimon: 'Digimon: 5 cartas y un solo mulligan (devuelves la mano al mazo, barajas y robas 5 nuevas).',
};

export async function openHandSimulator({ gameKey, deck }) {
  const sim = createHandSim(deck.cards, gameKey);
  if (sim.total === 0) return toast('El mazo no tiene cartas en la zona principal', 'error');
  const rules = rulesFor(gameKey);

  const title = el('h2', { class: 'hs-title', text: `Mano inicial · ${deck.name || 'Mazo'}` });
  const stage = el('div', { class: 'hs-stage' });
  const status = el('div', { class: 'hs-status', role: 'status', 'aria-live': 'polite' });
  const info = el('div', { class: 'hs-info' });
  const names = el('ol', { class: 'hs-sr', 'aria-label': 'Cartas en la mano' });
  const btn = (id, text, onClick) => el('button', { type: 'button', class: 'btn', id, text, onClick });
  const bNew = btn('hs-new', 'Nueva mano', () => run(dealNew));
  const bMull = btn('hs-mull', 'Mulligan', () => run(doMulligan));
  const bBottom = btn('hs-bottom', 'Poner al fondo', () => run(doBottom));
  const bDraw = btn('hs-draw', 'Robar carta', () => run(doDraw));
  const bClose = el('button', { type: 'button', class: 'hs-close', 'aria-label': 'Cerrar (Esc)', title: 'Cerrar (Esc)', text: '✕' });
  const dialog = el('dialog', { class: 'hand-sim', 'aria-label': 'Simulador de mano inicial' },
    el('header', { class: 'hs-bar' }, title, bClose),
    stage,
    el('div', { class: 'hs-controls' }, status, el('div', { class: 'hs-buttons' }, bNew, bMull, bBottom, bDraw), info),
    names);
  document.body.append(dialog);
  dialog.showModal();

  // ----- escena -----
  let renderer = null;
  let layout = computeLayout(1.6, rules.size);
  let scrollCur = 0;
  let scrollTarget = 0;
  let backImg = makeGenericBack();
  let backSrc = backImg.toDataURL();
  const slots = []; // { key, inst, cur, tgt, startAt, removeAt, front, frontSrc }
  const selected = new Set();
  let hoverKey = null;
  let busy = false;
  let alive = true;
  let last = performance.now();

  function makeRenderer(kind) {
    if (renderer) renderer.dispose();
    renderer = kind === 'css' ? createCssRenderer(stage) : createGLRenderer(stage);
    dialog.dataset.renderer = renderer.kind;
    onResize();
  }
  try { makeRenderer('webgl'); } catch (err) { makeRenderer('css'); }

  function onResize() {
    if (!renderer) return;
    const { w, h } = renderer.resize();
    layout = computeLayout(w / Math.max(1, h), rules.size);
    retarget();
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(stage);

  // fondo del mazo (propio del juego si existe en /img/backs, si no el genérico)
  const backReady = (async () => {
    try {
      const url = await findDefaultBack('');
      if (url) {
        const r = await loadCardImage(url);
        if (r && r.cors) { backImg = r.img; backSrc = r.src; }
      }
    } catch (err) { /* se queda el genérico */ }
  })();

  function retarget() {
    let i = 0;
    for (const s of slots) {
      if (s.removing) continue;
      s.tgt = slotTarget(i++, layout, scrollCur);
    }
  }

  function applyInteraction(s, base) {
    const t = { ...base };
    if (s.key === hoverKey && !s.removing) {
      t.y += 0.2;
      t.z += 0.8;
      t.s = 1.3;
      t.rz = 0;
    }
    if (selected.has(s.key)) { t.y -= 0.3; t.dim = 0.55; }
    return t;
  }

  async function addCard(inst, delay) {
    const key = String(inst.uid);
    const s = { key, inst, cur: { ...pileState(layout) }, tgt: null, startAt: performance.now() + delay, front: null, frontSrc: '' };
    slots.push(s);
    retarget();
    const res = await loadCardImage(inst.imageUrl);
    if (res) {
      s.cors = res.cors;
      s.front = res.img;
      s.frontSrc = res.src;
    } else {
      s.front = placeholderCanvas(inst.name);
      s.frontSrc = s.front.toDataURL();
      s.cors = true;
    }
    // WebGL no puede leer las imágenes de un servidor sin CORS: se pasa a CSS 3D
    if (renderer.kind === 'webgl' && !s.cors) makeRenderer('css');
    return s;
  }

  function removeCards(list) {
    for (const s of list) {
      s.removing = true;
      s.tgt = { ...pileState(layout) };
      s.removeAt = performance.now() + 520;
    }
    retarget();
  }

  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = reduced() ? 1 : 1 - Math.exp(-dt * 9);
    const count = slots.filter((s) => !s.removing).length;
    scrollTarget = Math.min(Math.max(0, scrollTarget), maxScroll(layout, count));
    scrollCur += (scrollTarget - scrollCur) * k;
    retarget();
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.removing && now > s.removeAt) { slots.splice(i, 1); continue; }
      if (now < s.startAt || !s.tgt) continue;
      const tgt = applyInteraction(s, s.tgt);
      for (const p of ['x', 'y', 'z', 'ry', 'rz', 's', 'dim']) s.cur[p] += (tgt[p] - s.cur[p]) * k;
    }
    if (renderer) {
      const ready = slots.filter((s) => s.front && now >= s.startAt - 1);
      try {
        renderer.draw({
          visH: layout.visH,
          back: backImg,
          backSrc,
          pile: { cur: pileState(layout), count: sim.library.length },
          cards: ready.map((s) => ({ key: s.key, front: s.front, frontSrc: s.frontSrc, cur: s.cur })),
        });
      } catch (err) {
        if (renderer.kind === 'webgl') makeRenderer('css'); // p. ej. imagen que WebGL no puede usar
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ----- acciones -----
  function refreshUi() {
    const pending = sim.pendingBottom;
    bMull.classList.toggle('hidden', !rules.mulligan);
    bBottom.classList.toggle('hidden', rules.mulligan !== 'london' || pending === 0);
    bMull.disabled = busy || !sim.canMulligan;
    bNew.disabled = busy;
    bDraw.disabled = busy || !sim.canDraw;
    bBottom.disabled = busy || selected.size !== pending;
    bBottom.textContent = `Poner al fondo (${selected.size}/${pending})`;
    if (rules.mulligan === 'redraw') bMull.textContent = sim.mulligans >= rules.maxMulligans ? 'Mulligan usado' : 'Mulligan (1 disponible)';
    else if (rules.mulligan === 'london') bMull.textContent = sim.mulligans ? `Mulligan (llevas ${sim.mulligans})` : 'Mulligan';
    if (pending) status.textContent = `Elige ${pending} carta${pending > 1 ? 's' : ''} para poner al fondo del mazo (${selected.size}/${pending}). Doble clic para verla en grande.`;
    else if (sim.total < rules.size) status.textContent = `El mazo principal solo tiene ${sim.total} cartas.`;
    else status.textContent = maxScroll(layout, sim.hand.length) > 0 ? 'La mano no cabe: desplázala con la rueda, arrastrando o con las flechas ← →. Clic en una carta para verla en grande.' : 'Pasa el ratón por una carta para resaltarla; clic para verla en grande.';
    info.textContent = `En la mano: ${sim.hand.length} · En el mazo: ${sim.library.length}${rules.mulligan ? ` · Mulligans: ${sim.mulligans}` : ''}`;
    clear(names);
    sim.hand.forEach((c) => names.append(el('li', { text: c.name })));
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    refreshUi();
    try { await action(); } finally { busy = false; refreshUi(); }
  }

  async function dealHand(cards) {
    const created = [];
    cards.forEach((c, i) => created.push(addCard(c, 120 + i * 110)));
    const done = await Promise.all(created);
    scrollTarget = maxScroll(layout, slots.filter((s) => !s.removing).length); // se ve la última carta repartida
    await sleep(120 + cards.length * 110 + 350);
    return done;
  }

  async function dealNew() {
    removeCards(slots.filter((s) => !s.removing));
    selected.clear();
    await sleep(420);
    scrollTarget = 0;
    await dealHand(sim.deal());
  }
  async function doMulligan() {
    removeCards(slots.filter((s) => !s.removing));
    selected.clear();
    await sleep(420);
    scrollTarget = 0;
    if (sim.mulligan()) await dealHand(sim.hand.slice());
  }
  async function doBottom() {
    const uids = [...selected].map(Number);
    const gone = slots.filter((s) => selected.has(s.key));
    selected.clear();
    if (sim.bottom(uids)) removeCards(gone);
    await sleep(520);
  }
  async function doDraw() {
    const c = sim.draw();
    if (c) await dealHand([c]);
  }

  // ----- ratón / teclado -----
  const pos = (e) => renderer.hit(e.clientX, e.clientY);
  stage.addEventListener('pointermove', (e) => {
    const key = pos(e);
    hoverKey = key;
    stage.style.cursor = key ? 'pointer' : 'default';
  });
  stage.addEventListener('pointerleave', () => { hoverKey = null; });
  // Desplazar la mano: rueda, arrastrar o flechas
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollTarget += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.004;
  }, { passive: false });
  let drag = null;
  let dragged = false;
  stage.addEventListener('pointerdown', (e) => {
    dragged = false;
    drag = { x: e.clientX, start: scrollTarget };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) dragged = true;
    if (dragged) scrollTarget = drag.start - dx / (stage.getBoundingClientRect().height / layout.visH);
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  const openViewer = (key) => {
    const s = slots.find((x) => x.key === key);
    if (s) openCardViewer({ name: s.inst.name, imageUrl: s.inst.imageUrl, imageBack: s.inst.imageBack, backKind: s.inst.backKind });
  };
  let clickTimer = 0;
  stage.addEventListener('click', (e) => {
    const key = pos(e);
    if (!key || busy || dragged) return;
    if (sim.pendingBottom > 0) {
      // elegir cartas para el fondo; el doble clic abre el visor
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (selected.has(key)) selected.delete(key);
        else if (selected.size < sim.pendingBottom) selected.add(key);
        refreshUi();
      }, 220);
    } else openViewer(key);
  });
  stage.addEventListener('dblclick', (e) => {
    const key = pos(e);
    if (key && sim.pendingBottom > 0) { clearTimeout(clickTimer); openViewer(key); }
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') scrollTarget += 0.6;
    else if (e.key === 'ArrowLeft') scrollTarget -= 0.6;
    else if (e.key === 'n' || e.key === 'N') bNew.click();
    else if ((e.key === 'm' || e.key === 'M') && !bMull.disabled) bMull.click();
    else if ((e.key === 'd' || e.key === 'D') && !bDraw.disabled) bDraw.click();
  });

  const close = () => {
    alive = false;
    ro.disconnect();
    if (renderer) renderer.dispose();
    dialog.close();
    dialog.remove();
  };
  bClose.addEventListener('click', close);
  dialog.addEventListener('cancel', () => { alive = false; ro.disconnect(); if (renderer) renderer.dispose(); setTimeout(() => dialog.remove(), 0); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  const hint = el('p', { class: 'hs-rule', text: RULE_TEXT[gameKey] || '' });
  dialog.querySelector('.hs-controls').append(hint);

  refreshUi();
  await run(async () => { await backReady; await dealHand(sim.deal()); });
  return { close, sim };
}
