// Lógica de la página de login / registro (index.html)
import { api } from './api.js';

const tabs = document.querySelectorAll('.tab');
const form = document.getElementById('auth-form');
const errorBox = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');
const registerOnly = document.querySelectorAll('.register-only');
const passwordInput = document.getElementById('password');

let mode = 'login';

function setMode(newMode) {
  mode = newMode;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  registerOnly.forEach((node) => {
    node.classList.toggle('hidden', mode !== 'register');
    node.querySelectorAll('input').forEach((i) => (i.required = mode === 'register'));
  });
  document.getElementById('identifier-label').textContent =
    mode === 'login' ? 'Usuario o email' : 'Nombre de usuario';
  submitBtn.textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  errorBox.textContent = '';
}

tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.textContent = '';
  submitBtn.disabled = true;

  const identifier = document.getElementById('identifier').value.trim();
  const password = passwordInput.value;

  try {
    if (mode === 'login') {
      await api.post('/auth/login', { identifier, password });
    } else {
      const email = document.getElementById('email').value.trim();
      await api.post('/auth/register', { username: identifier, email, password });
    }
    window.location.href = 'home.html';
  } catch (err) {
    errorBox.textContent = err.message;
    submitBtn.disabled = false;
  }
});

// ---------- Inicio de sesión con Google (Google Identity Services) ----------
const googleSection = document.getElementById('google-section');
const googleBtn = document.getElementById('google-btn');

// Paso extra para cuentas nuevas de Google: elegir nombre de usuario
const mainView = document.getElementById('main-view');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('google-username');
const usernameError = document.getElementById('username-error');
const usernameSubmit = document.getElementById('username-submit');

// El ID token de Google se guarda solo en memoria mientras se elige el nombre
let pendingCredential = null;

function showUsernameStep({ email, suggestedUsername }) {
  document.getElementById('google-email').textContent = email;
  usernameInput.value = suggestedUsername || '';
  usernameError.textContent = '';
  mainView.classList.add('hidden');
  usernameForm.classList.remove('hidden');
  usernameInput.focus();
  usernameInput.select();
}

function backToMainView() {
  pendingCredential = null;
  usernameForm.classList.add('hidden');
  mainView.classList.remove('hidden');
}

async function handleGoogleCredential(response) {
  errorBox.textContent = '';
  try {
    // "credential" es un ID token firmado por Google; el servidor lo verifica
    const result = await api.post('/auth/google', { credential: response.credential });
    if (result.needsUsername) {
      pendingCredential = response.credential;
      showUsernameStep(result);
      return;
    }
    window.location.href = 'home.html';
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  usernameError.textContent = '';
  const username = usernameInput.value.trim();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    usernameError.textContent = 'El usuario debe tener 3-20 caracteres (letras, números o _)';
    return;
  }

  usernameSubmit.disabled = true;
  try {
    await api.post('/auth/google', { credential: pendingCredential, username });
    window.location.href = 'home.html';
  } catch (err) {
    usernameError.textContent = err.message;
    usernameSubmit.disabled = false;
    // Si el token de Google caducó o hay un conflicto con el email, volvemos al inicio
    if (err.status === 401 || (err.status === 409 && /email/i.test(err.message))) {
      errorBox.textContent = err.message;
      backToMainView();
    }
  }
});

document.getElementById('username-cancel').addEventListener('click', backToMainView);

function renderGoogleButton(clientId) {
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential,
    ux_mode: 'popup',
  });
  window.google.accounts.id.renderButton(googleBtn, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    locale: 'es',
    width: 320,
  });
  googleSection.classList.remove('hidden');
}

async function initGoogle() {
  let clientId = null;
  try {
    ({ googleClientId: clientId } = await api.get('/auth/config'));
  } catch (err) {
    return; // sin configuración: se oculta el botón y el login normal sigue funcionando
  }
  if (!clientId) return;

  if (window.google && window.google.accounts) {
    renderGoogleButton(clientId);
  } else {
    // El script de Google se carga en diferido: esperamos a que termine
    document.getElementById('gsi-script').addEventListener('load', () => renderGoogleButton(clientId));
  }
}

initGoogle();

// Si ya hay sesión iniciada, vamos directos a la home
api
  .get('/auth/me')
  .then(() => window.location.replace('home.html'))
  .catch(() => {});

setMode('login');
