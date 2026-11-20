// Cliente centralizado para hablar con la API (Netlify Functions).
// El navegador NUNCA habla con MongoDB: solo con /api/*.

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    // respuesta sin JSON
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || 'Error de conexión con el servidor');
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};
