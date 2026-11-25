// Vista ampliada de las cartas:
//  1. TOOLTIP: al pasar el ratón sobre una carta se muestra en grande (texto legible).
//  2. VISTA 3D: al hacer clic se abre un popup, con el resto de la página oscurecida, donde la
//     carta se dibuja en un <canvas> WebGL: se puede girar en horizontal, hacer zoom y darle la
//     vuelta para ver el dorso (cartas de dos caras).
//
// Los elementos con la clase "previewable" (ver markPreviewable en ui.js) llevan los datos:
//   data-card-name, data-card-image (imagen pequeña) y data-card-back (dorso, opcional).
//
// WebGL necesita que el servidor de la imagen permita su uso en un canvas (cabecera CORS). Si no
// lo permite, o el navegador no tiene WebGL, se usa automáticamente la misma vista con
// transformaciones CSS 3D, que funciona con cualquier imagen.
import { sizedUrl, viewerUrls, imageChain, betterImageUrl } from './card-images.js';

const CARD_ASPECT = 63 / 88; // proporción de una carta (ancho / alto)
const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  children.flat().forEach((c) => c && node.append(c.nodeType ? c : document.createTextNode(String(c))));
  return node;
}

function icon(paths, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ====================================================================
// Dorso genérico (cartas de una sola cara): se dibuja en un canvas 2D
// ====================================================================
export function makeGenericBack() {
  const w = 488;
  const hgt = Math.round(w / CARD_ASPECT);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0f1a';
  g.fillRect(0, 0, w, hgt);
  const grad = g.createLinearGradient(0, 0, w, hgt);
  grad.addColorStop(0, '#1b2a4a');
  grad.addColorStop(1, '#0d1426');
  g.fillStyle = grad;
  g.fillRect(24, 24, w - 48, hgt - 48);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  for (let i = -hgt; i < w + hgt; i += 22) {
    g.beginPath();
    g.moveTo(i, 24);
    g.lineTo(i + hgt, hgt - 24);
    g.stroke();
  }
  g.strokeStyle = '#d98a1f';
  g.lineWidth = 5;
  g.strokeRect(24, 24, w - 48, hgt - 48);
  g.fillStyle = 'rgba(8,12,22,0.9)';
  g.beginPath();
  g.ellipse(w / 2, hgt / 2, 150, 100, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d98a1f';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#f0b44a';
  g.font = 'bold 56px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TCG', w / 2, hgt / 2 - 8);
  g.font = '600 22px system-ui, sans-serif';
  g.fillStyle = '#9fb0d0';
  g.fillText('MANAGER', w / 2, hgt / 2 + 32);
  return c;
}

// ====================================================================
// Carga de imágenes
// ====================================================================
function loadImage(url, { cors }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
  });
}

// Prueba las versiones de mayor a menor calidad hasta que una cargue
async function loadCardImage(small, { cors }) {
  let lastError = null;
  for (const url of viewerUrls(small)) {
    try {
      return await loadImage(url, { cors });
    } catch (err) {
      lastError = err;
      if (cors) {
        // Si la imagen existe pero su servidor no permite leerla (CORS), no se baja a una versión peor:
        // se falla para que la vista sin WebGL (CSS 3D) muestre esta, que es la de mayor calidad.
        const exists = await loadImage(url, { cors: false }).then(() => true, () => false);
        if (exists) throw err;
      }
    }
  }
  throw lastError;
}

// Las imágenes pequeñas (p. ej. 421x614 px) se ven borrosas al ampliarlas: se escalan al doble con
// suavizado de calidad y un filtro de nitidez ligero. No inventa detalle, pero el texto se lee mejor.
// Solo funciona con imágenes que se pueden leer (CORS); si no, se usa la original.
function enhanceImage(img) {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || h >= 900) return img;
    const k = h < 700 ? 2 : 1.5;
    const out = document.createElement('canvas');
    out.width = Math.round(w * k);
    out.height = Math.round(h * k);
    const g = out.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, out.width, out.height);
    if (!('filter' in g)) return out;
    const blurred = document.createElement('canvas');
    blurred.width = out.width;
    blurred.height = out.height;
    const bg = blurred.getContext('2d', { willReadFrequently: true });
    bg.filter = 'blur(1.2px)';
    bg.drawImage(out, 0, 0);
    const a = g.getImageData(0, 0, out.width, out.height);
    const b = bg.getImageData(0, 0, out.width, out.height).data;
    const d = a.data;
    const amount = 0.6;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, d[i] + (d[i] - b[i]) * amount));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + (d[i + 1] - b[i + 1]) * amount));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + (d[i + 2] - b[i + 2]) * amount));
    }
    g.putImageData(a, 0, 0);
    return out;
  } catch (err) {
    return img; // imagen contaminada u otro error: sin mejora
  }
}

// ====================================================================
// Dorso real de cada juego (cartas de una sola cara)
// ====================================================================
// Se busca primero un archivo propio en /img/backs/<juego>.(webp|jpg|png) (mismo origen, así WebGL
// siempre puede usarlo). Para MTG hay además un respaldo en Scryfall. Si no hay ninguno, dorso genérico.
const DEFAULT_BACKS = {
  mtg: ['https://backs.scryfall.io/large/2/2/222b7a3b-2321-4d4c-af19-19338b134971.jpg'],
};
const backCache = {};

function currentGame() {
  try {
    return new URLSearchParams(location.search).get('game') || '';
  } catch (err) {
    return '';
  }
}

export async function findDefaultBack(kind) {
  const game = currentGame();
  if (!/^[a-z0-9-]+$/.test(game)) return '';
  // Algunos tipos de carta tienen un dorso distinto (p. ej. Digi-Egg de Digimon): archivo <juego>-<tipo>
  const name = /^[a-z0-9]+$/.test(kind || '') ? `${game}-${kind}` : game;
  if (backCache[name] !== undefined) return backCache[name];
  const candidates = [`/img/backs/${name}.webp`, `/img/backs/${name}.jpg`, `/img/backs/${name}.png`, ...(name === game ? DEFAULT_BACKS[game] || [] : [])];
  let found = '';
  for (const url of candidates) {
    try {
      await loadImage(url, { cors: false });
      found = url;
      break;
    } catch (err) {
      /* siguiente candidato */
    }
  }
  backCache[name] = found;
  return found;
}

// ====================================================================
// Matemáticas mínimas de matrices 4x4 (column-major, como WebGL)
// ====================================================================
export const mat = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return out;
  },
  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  },
  translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  scale: (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1],
  rotateX: (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1],
  rotateY: (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1],
  rotateZ: (a) => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

// ====================================================================
// Renderizador WebGL
// ====================================================================
const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform mat4 u_mvp;
varying vec2 v_uv;
varying vec2 v_pos;
void main() {
  v_uv = a_uv;
  v_pos = a_pos;
  gl_Position = u_mvp * vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_aspect;
uniform vec3 u_normal;   // normal de la cara en el espacio de la cámara
uniform vec3 u_light;
varying vec2 v_uv;
varying vec2 v_pos;

// Distancia con signo a un rectángulo redondeado (unidades: alto de la carta = 1)
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  float d = roundedBox(v_pos, vec2(u_aspect * 0.5, 0.5), 0.045);
  float alpha = 1.0 - smoothstep(-0.003, 0.003, d);
  if (alpha <= 0.001) discard;
  vec4 c = texture2D(u_tex, v_uv);
  // brillo suave según el ángulo de la luz (efecto de carta con acabado satinado)
  vec3 n = normalize(u_normal);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-normalize(u_light), n), viewDir), 0.0), 28.0) * 0.22;
  float diffuse = 0.9 + 0.1 * max(dot(n, normalize(u_light)), 0.0);
  vec3 rgb = c.rgb * diffuse + vec3(spec);
  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

function createGLRenderer(canvas) {
  const gl =
    canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true }) ||
    canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) throw new Error('Este navegador no tiene WebGL');
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Error de shader');
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('No se pudo preparar WebGL');
  gl.useProgram(program);

  const loc = {
    pos: gl.getAttribLocation(program, 'a_pos'),
    uv: gl.getAttribLocation(program, 'a_uv'),
    mvp: gl.getUniformLocation(program, 'u_mvp'),
    tex: gl.getUniformLocation(program, 'u_tex'),
    aspect: gl.getUniformLocation(program, 'u_aspect'),
    normal: gl.getUniformLocation(program, 'u_normal'),
    light: gl.getUniformLocation(program, 'u_light'),
  };

  // Dos caras: la delantera mira a +z y la trasera a -z (con el cull de caras solo se dibuja la visible)
  const a = CARD_ASPECT / 2;
  const front = new Float32Array([-a, -0.5, 0, 0, a, -0.5, 1, 0, a, 0.5, 1, 1, -a, -0.5, 0, 0, a, 0.5, 1, 1, -a, 0.5, 0, 1]);
  const back = new Float32Array([-a, -0.5, 1, 0, a, 0.5, 0, 1, a, -0.5, 0, 0, -a, -0.5, 1, 0, -a, 0.5, 1, 1, a, 0.5, 0, 1]);
  const makeBuffer = (data) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  };
  const buffers = { front: makeBuffer(front), back: makeBuffer(back) };

  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  const textures = { front: null, back: null };

  function makeTexture(source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); // lanza SecurityError si la imagen está "contaminada"
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isGL2) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // WebGL1: sin mipmaps (imágenes no potencia de 2)
    }
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  }

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let width = 1;
  let height = 1;
  const FOV = (30 * Math.PI) / 180;

  // Distancia de la cámara para que la carta quepa en pantalla (zoom = 1)
  function baseDistance() {
    const visibleHeightPerUnit = 2 * Math.tan(FOV / 2);
    const needByHeight = 1 / (0.86 * visibleHeightPerUnit);
    const needByWidth = CARD_ASPECT / (0.92 * visibleHeightPerUnit * (width / height));
    return Math.max(needByHeight, needByWidth);
  }

  function matrices(state) {
    const dist = baseDistance();
    const proj = mat.perspective(FOV, width / height, 0.1, 50);
    const worldPerPx = (2 * dist * Math.tan(FOV / 2)) / height;
    let model = mat.multiply(mat.rotateX(state.pitch), mat.multiply(mat.rotateY(state.yaw), mat.scale(state.zoom)));
    model = mat.multiply(mat.translate(state.panX * worldPerPx, -state.panY * worldPerPx, 0), model);
    const view = mat.translate(0, 0, -dist);
    return { mvp: mat.multiply(proj, mat.multiply(view, model)), model };
  }

  function drawFace(side, texture, state) {
    const { mvp } = matrices(state);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[side]);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(loc.uv);
    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc.tex, 0);
    gl.uniform1f(loc.aspect, CARD_ASPECT);
    gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(mvp));
    // Normal de la cara en el espacio de la cámara (rotación del modelo aplicada a +z / -z)
    const sign = side === 'front' ? 1 : -1;
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const cx = Math.cos(state.pitch);
    const sx = Math.sin(state.pitch);
    // rotateY * (0,0,sign) = (sign*sy, 0, sign*cy); luego rotateX
    const nx = sign * sy;
    const ny = -sx * (sign * cy);
    const nz = cx * (sign * cy);
    gl.uniform3f(loc.normal, nx, ny, nz);
    gl.uniform3f(loc.light, -0.45, 0.55, 0.7);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return {
    kind: 'webgl',
    setTextures(frontSource, backSource) {
      textures.front = makeTexture(frontSource);
      textures.back = makeTexture(backSource);
    },
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    },
    render(state) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!textures.front) return;
      drawFace('front', textures.front, state);
      drawFace('back', textures.back, state);
    },
    // Rectángulo (en px de la pantalla) que ocupa la carta ahora mismo, para saber si un clic cae fuera
    bounds(state) {
      const { mvp } = matrices(state);
      const a2 = CARD_ASPECT / 2;
      const rect = canvas.getBoundingClientRect();
      const xs = [];
      const ys = [];
      for (const [x, y] of [[-a2, -0.5], [a2, -0.5], [a2, 0.5], [-a2, 0.5]]) {
        const cx = mvp[0] * x + mvp[4] * y + mvp[12];
        const cy = mvp[1] * x + mvp[5] * y + mvp[13];
        const cw = mvp[3] * x + mvp[7] * y + mvp[15];
        xs.push(rect.left + ((cx / cw) * 0.5 + 0.5) * rect.width);
        ys.push(rect.top + (1 - ((cy / cw) * 0.5 + 0.5)) * rect.height);
      }
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    },
    dispose() {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}

// ====================================================================
// Renderizador alternativo con CSS 3D (funciona con imágenes sin CORS)
// ====================================================================
function createCssRenderer(stage, frontSrc, backSource) {
  const card = h('div', { class: 'cv-css-card' });
  const frontImg = h('img', { class: 'cv-css-face', alt: '', referrerpolicy: 'no-referrer', draggable: 'false' });
  frontImg.src = frontSrc;
  const backImg = h('img', { class: 'cv-css-face cv-css-back', alt: '', referrerpolicy: 'no-referrer', draggable: 'false' });
  backImg.src = typeof backSource === 'string' ? backSource : backSource.toDataURL();
  card.append(frontImg, backImg);
  const holder = h('div', { class: 'cv-css-holder' }, card);
  stage.append(holder);
  return {
    kind: 'css',
    setTextures() {},
    resize() {},
    render(state) {
      card.style.transform = `translate(${state.panX}px, ${state.panY}px) rotateX(${state.pitch}rad) rotateY(${state.yaw}rad) scale(${state.zoom})`;
    },
    bounds() {
      const r = card.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    },
    dispose() {
      holder.remove();
    },
  };
}

// ====================================================================
// Vista 3D (popup)
// ====================================================================
let dialog = null;
let session = null; // vista abierta ahora mismo

function buildDialog() {
  const title = h('span', { class: 'cv-title' });
  const note = h('span', { class: 'cv-note' });
  const btn = (label, svg, onClick) => h('button', { class: 'cv-btn', type: 'button', 'aria-label': label, title: label, onClick }, svg);
  const flipBtn = btn('Dar la vuelta (F)', icon(['M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 21v-5h5']));
  const zoomOut = btn('Alejar (−)', icon(['M5 12h14']));
  const zoomIn = btn('Acercar (+)', icon(['M5 12h14', 'M12 5v14']));
  const reset = btn('Restablecer (0)', icon(['M4 12a8 8 0 1 0 2.5-5.8', 'M4 4v4h4']));
  const close = btn('Cerrar (Esc)', icon(['M6 6l12 12', 'M18 6L6 18']));
  const stage = h('div', { class: 'cv-stage' });
  const status = h('div', { class: 'cv-status', role: 'status' });
  const hint = h('p', { class: 'cv-hint', text: 'Arrastra para girar · Rueda o pellizco para zoom · Mayús + arrastrar para mover · Doble clic para restablecer' });
  const bar = h('header', { class: 'cv-bar' }, h('div', { class: 'cv-heading' }, title, note), h('div', { class: 'cv-actions' }, flipBtn, zoomOut, zoomIn, reset, close));
  const dlg = h('dialog', { class: 'card-viewer', 'aria-label': 'Vista 3D de la carta' }, stage, bar, status, hint);
  document.body.append(dlg);
  return { dlg, title, note, stage, status, hint, buttons: { flipBtn, zoomOut, zoomIn, reset, close } };
}

export async function openCardViewer({ name, imageUrl, imageBack, backKind }) {
  if (!imageUrl) return;
  hideTip();
  if (!dialog) dialog = buildDialog();
  if (session) session.destroy();

  const ui = dialog;
  ui.title.textContent = name || 'Carta';
  ui.note.textContent = '';
  ui.status.textContent = 'Cargando…';
  ui.status.classList.remove('hidden');
  ui.stage.textContent = '';
  if (!ui.dlg.open) ui.dlg.showModal();
  const ownBack = !!imageBack;
  if (!imageBack) imageBack = await findDefaultBack(backKind);

  // Estado de la vista
  const state = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
  let renderer = null;
  let raf = 0;
  let tween = null;
  let velocity = 0; // inercia del giro (rad/ms)
  let disposed = false;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const draw = () => {
    raf = 0;
    if (disposed || !renderer) return;
    renderer.render(state);
    ui.stage.dataset.yaw = state.yaw.toFixed(3);
    ui.stage.dataset.zoom = state.zoom.toFixed(3);
    ui.stage.dataset.pitch = state.pitch.toFixed(3);
  };
  const requestDraw = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(draw);
  };

  // Animación suave hacia unos valores
  function animateTo(target, ms = 380) {
    if (reducedMotion()) {
      Object.assign(state, target);
      requestDraw();
      return;
    }
    const from = { ...state };
    const start = performance.now();
    velocity = 0;
    const token = {};
    tween = token;
    const step = (now) => {
      if (tween !== token || disposed) return;
      const t = clamp((now - start) / ms, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const key of Object.keys(target)) state[key] = from[key] + (target[key] - from[key]) * e;
      draw();
      if (t < 1) requestAnimationFrame(step);
      else tween = null;
    };
    requestAnimationFrame(step);
  }

  const flip = () => animateTo({ yaw: Math.round(state.yaw / Math.PI) * Math.PI + Math.PI, pitch: 0 });
  const setZoom = (z, ratioPoint) => {
    const next = clamp(z, 0.6, 5);
    if (ratioPoint) {
      // El punto bajo el cursor se mantiene fijo al hacer zoom
      const ratio = next / state.zoom;
      state.panX = ratioPoint.x - (ratioPoint.x - state.panX) * ratio;
      state.panY = ratioPoint.y - (ratioPoint.y - state.panY) * ratio;
    }
    state.zoom = next;
    if (next <= 1) {
      state.panX *= 0.6;
      state.panY *= 0.6;
    }
    requestDraw();
  };
  const resetView = () => animateTo({ yaw: Math.round(state.yaw / (2 * Math.PI)) * 2 * Math.PI, pitch: 0, zoom: 1, panX: 0, panY: 0 });

  // ----- Imágenes y renderizador -----
  const generic = makeGenericBack();
  let backIsGeneric = !imageBack;
  const loadBack = async (cors) => {
    if (!imageBack) return generic;
    try {
      return await loadCardImage(imageBack, { cors });
    } catch (err) {
      
      return generic;
    }
  };

  async function setup() {
    // 1) WebGL (necesita imágenes con CORS)
    try {
      const canvas = h('canvas', { class: 'cv-canvas', 'aria-label': `Carta ${name || ''} en 3D` });
      ui.stage.append(canvas);
      const gl = createGLRenderer(canvas);
      const [front, back] = await Promise.all([loadCardImage(imageUrl, { cors: true }), loadBack(true)]);
      if (disposed) return gl.dispose();
      if (back === generic && imageBack) backIsGeneric = true;
      gl.resize();
      gl.setTextures(enhanceImage(front), enhanceImage(back)); // puede lanzar SecurityError
      ui.stage.dataset.texture = `${front.naturalWidth}x${front.naturalHeight}`;
      renderer = gl;
    } catch (err) {
      ui.stage.textContent = '';
      renderer = null;
    }
    // 2) CSS 3D (cualquier imagen)
    if (!renderer && !disposed) {
      backIsGeneric = !imageBack;
      try {
        const front = await loadCardImage(imageUrl, { cors: false });
        const back = imageBack ? await loadCardImage(imageBack, { cors: false }).catch(() => ((backIsGeneric = true), generic)) : generic;
        if (disposed) return;
        renderer = createCssRenderer(ui.stage, front.src, back === generic ? generic : back.src);
      } catch (err) {
        ui.status.textContent = 'No se pudo cargar la imagen de la carta.';
        return;
      }
    }
    ui.status.classList.add('hidden');
    ui.stage.dataset.renderer = renderer.kind;
    ui.note.textContent = backIsGeneric ? 'Dorso genérico' : ownBack ? 'Carta de dos caras' : 'Dorso del juego';
    renderer.resize();
    draw();
  }

  // ----- Interacción -----
  const pointers = new Map();
  let drag = null;
  let lastMove = 0;
  const stageCenter = () => {
    const r = ui.stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const onPointerDown = (e) => {
    if (e.target.closest('.cv-bar, .cv-hint')) return;
    ui.stage.setPointerCapture && ui.stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tween = null;
    velocity = 0;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      moved: 0,
      time: performance.now(),
      pan: e.shiftKey || e.button === 1 || e.button === 2,
      pinch: pointers.size > 1 ? { dist: pinchDistance(), zoom: state.zoom, mid: pinchMid() } : null,
    };
    ui.stage.classList.add('dragging');
  };

  const pinchDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const pinchMid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onPointerMove = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev || !drag) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (pointers.size >= 2) {
      // Pellizco: zoom y desplazamiento con dos dedos
      const mid = pinchMid();
      if (!drag.pinch) drag.pinch = { dist: pinchDistance(), zoom: state.zoom, mid };
      const c = stageCenter();
      setZoom(drag.pinch.zoom * (pinchDistance() / drag.pinch.dist), { x: mid.x - c.x, y: mid.y - c.y });
      state.panX += mid.x - drag.pinch.mid.x;
      state.panY += mid.y - drag.pinch.mid.y;
      drag.pinch.mid = mid;
    } else if (drag.pan || e.shiftKey) {
      state.panX += dx;
      state.panY += dy;
    } else {
      // Giro horizontal (y un poco de inclinación vertical)
      const now = performance.now();
      const dyaw = dx * 0.011;
      state.yaw += dyaw;
      state.pitch = clamp(state.pitch + dy * 0.004, -0.5, 0.5);
      velocity = dyaw / Math.max(1, now - lastMove);
      lastMove = now;
    }
    requestDraw();
  };

  const onPointerUp = (e) => {
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      ui.stage.classList.remove('dragging');
      drag = null;
      if (wasDrag && wasDrag.moved < 6 && performance.now() - wasDrag.time < 400) {
        // Clic sin arrastrar fuera de la carta: se cierra
        const b = renderer && renderer.bounds(state);
        if (b && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)) return ui.dlg.close();
      } else if (Math.abs(velocity) > 0.0004 && !reducedMotion()) {
        let last = performance.now();
        const glide = (now) => {
          if (disposed || drag || tween) return;
          const dt = now - last;
          last = now;
          state.yaw += velocity * dt;
          velocity *= Math.pow(0.992, dt);
          draw();
          if (Math.abs(velocity) > 0.00015) requestAnimationFrame(glide);
        };
        requestAnimationFrame(glide);
      }
    } else {
      drag = { ...(wasDrag || {}), pinch: null, moved: 99 };
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const c = stageCenter();
    setZoom(state.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0016)), { x: e.clientX - c.x, y: e.clientY - c.y });
  };
  const onDblClick = (e) => {
    if (e.target.closest('.cv-bar')) return;
    resetView();
  };
  const onKey = (e) => {
    const key = e.key;
    if (key === 'ArrowLeft') animateTo({ yaw: state.yaw - 0.35 }, 160);
    else if (key === 'ArrowRight') animateTo({ yaw: state.yaw + 0.35 }, 160);
    else if (key === '+' || key === '=') setZoom(state.zoom * 1.2);
    else if (key === '-' || key === '_') setZoom(state.zoom / 1.2);
    else if (key === '0') resetView();
    else if (key === 'f' || key === 'F') flip();
    else return;
    e.preventDefault();
  };
  const onResize = () => {
    if (renderer) {
      renderer.resize();
      requestDraw();
    }
  };
  const onBackdrop = (e) => {
    if (e.target === ui.dlg) ui.dlg.close(); // clic en el fondo (fuera del contenido)
  };

  ui.stage.addEventListener('pointerdown', onPointerDown);
  ui.stage.addEventListener('pointermove', onPointerMove);
  ui.stage.addEventListener('pointerup', onPointerUp);
  ui.stage.addEventListener('pointercancel', onPointerUp);
  ui.stage.addEventListener('wheel', onWheel, { passive: false });
  ui.stage.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.dlg.addEventListener('dblclick', onDblClick);
  ui.dlg.addEventListener('keydown', onKey);
  ui.dlg.addEventListener('click', onBackdrop);
  window.addEventListener('resize', onResize);
  const b = ui.buttons;
  const handlers = [
    [b.flipBtn, flip],
    [b.zoomOut, () => setZoom(state.zoom / 1.25)],
    [b.zoomIn, () => setZoom(state.zoom * 1.25)],
    [b.reset, resetView],
    [b.close, () => ui.dlg.close()],
  ];
  handlers.forEach(([btn, fn]) => (btn.onclick = fn));

  function destroy() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    ui.stage.removeEventListener('pointerdown', onPointerDown);
    ui.stage.removeEventListener('pointermove', onPointerMove);
    ui.stage.removeEventListener('pointerup', onPointerUp);
    ui.stage.removeEventListener('pointercancel', onPointerUp);
    ui.stage.removeEventListener('wheel', onWheel);
    ui.dlg.removeEventListener('dblclick', onDblClick);
    ui.dlg.removeEventListener('keydown', onKey);
    ui.dlg.removeEventListener('click', onBackdrop);
    window.removeEventListener('resize', onResize);
    ui.dlg.removeEventListener('close', onClose);
    if (renderer) renderer.dispose();
    ui.stage.textContent = '';
    delete ui.stage.dataset.renderer;
    session = null;
  }
  const onClose = () => destroy();
  ui.dlg.addEventListener('close', onClose);

  session = { destroy };
  ui.dlg.focus();
  await setup();
}

// ====================================================================
// Tooltip al pasar el ratón
// ====================================================================
let tip = null;
let tipImg = null;
let tipTimer = 0;
let tipTarget = null;
let mouse = { x: 0, y: 0 };

function ensureTip() {
  if (tip) return;
  tipImg = h('img', { alt: '', referrerpolicy: 'no-referrer', draggable: 'false' });
  tip = h('div', { class: 'card-tip', 'aria-hidden': 'true' }, tipImg);
  document.body.append(tip);
}

function placeTip() {
  if (!tip) return;
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const gap = 22;
  let left = mouse.x + gap;
  if (left + w > window.innerWidth - 8) left = mouse.x - gap - w;
  left = Math.max(8, left);
  const top = clamp(mouse.y - hgt / 3, 8, Math.max(8, window.innerHeight - hgt - 8));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  if (tip) tip.classList.remove('show');
}

function showTip(target) {
  ensureTip();
  const small = betterImageUrl(target.dataset.cardImage);
  const big = sizedUrl(small, 'tip');
  tipImg.onload = () => {
    if (tipTarget !== target) return;
    tip.classList.add('show');
    placeTip();
  };
  const queue = [small, ...imageChain(small)].filter((u) => u && u !== big);
  tipImg.onerror = () => {
    const next = queue.shift();
    if (next) tipImg.src = next; // si no existe el tamaño grande, la imagen original o su alternativa
    else tipImg.onerror = null;
  };
  tipImg.alt = target.dataset.cardName || '';
  tipImg.src = big;
}

let initialized = false;

// Activa el tooltip y la vista 3D para todos los elementos "previewable" de la página
export function initCardPreview() {
  if (initialized) return;
  initialized = true;
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (canHover) {
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest && e.target.closest('.previewable');
      if (!target || target === tipTarget || (dialog && dialog.open)) return;
      hideTip();
      tipTarget = target;
      mouse = { x: e.clientX, y: e.clientY };
      tipTimer = setTimeout(() => tipTarget === target && showTip(target), 140);
    });
    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest && e.target.closest('.previewable');
      if (target && target === tipTarget && !(e.relatedTarget && target.contains(e.relatedTarget))) hideTip();
    });
    let moveFrame = 0; // como mucho una recolocación por fotograma
    document.addEventListener('mousemove', (e) => {
      mouse = { x: e.clientX, y: e.clientY };
      if (moveFrame || !tip || !tip.classList.contains('show')) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        placeTip();
      });
    }, { passive: true });
    document.addEventListener('mousedown', hideTip);
    document.addEventListener('scroll', hideTip, true);
    window.addEventListener('blur', hideTip);
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest && e.target.closest('.previewable');
    if (!target) return;
    e.preventDefault();
    openCardViewer({ name: target.dataset.cardName, imageUrl: target.dataset.cardImage, imageBack: target.dataset.cardBack, backKind: target.dataset.cardBackKind });
  });
}
