// Diálogos "Compartir" (enlace público de solo lectura) e "Historial" (versiones anteriores) de un mazo.
import { el, clear, toast } from './ui.js';
import { api } from './api.js';

function makeDialog(title, label) {
  const dialog = el('dialog', { class: 'tr-dialog', 'aria-label': label || title });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', () => setTimeout(() => dialog.remove(), 0));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  const body = el('div', { class: 'tr-pane' });
  dialog.append(el('div', { class: 'tr-head' }, el('h2', { text: title }), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cerrar', onClick: close })), body);
  document.body.append(dialog);
  dialog.showModal();
  return { body, close };
}

// deck: mazo guardado (con _id). onChange(shareId|null) avisa al editor.
export function openShareDialog({ deck, onChange }) {
  const { body } = makeDialog('Compartir mazo');
  const render = () => {
    clear(body);
    const url = deck.shareId ? `${window.location.origin}/d/${deck.shareId}` : '';
    if (!deck.shareId) {
      body.append(
        el('p', { text: 'Crea un enlace público de solo lectura: cualquiera que lo tenga puede ver el mazo (sin cuenta), exportar la lista y, si tiene cuenta, copiarlo a la suya. Nunca se muestra tu usuario.' }),
        el('button', { type: 'button', class: 'btn', text: 'Crear enlace', onClick: () => set(true) })
      );
    } else {
      const input = el('input', { type: 'text', readonly: '', value: url, 'aria-label': 'Enlace del mazo' });
      input.addEventListener('focus', () => input.select());
      body.append(
        el('p', { text: 'Este mazo se comparte con el siguiente enlace. Muestra la versión guardada (guarda el mazo para actualizarla).' }),
        input,
        el('div', { class: 'toolbar' },
          el('button', { type: 'button', class: 'btn btn-sm', text: 'Copiar enlace', onClick: () => navigator.clipboard.writeText(url).then(() => toast('Enlace copiado', 'success'), () => toast('No se pudo copiar', 'error')) }),
          el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Dejar de compartir', onClick: () => set(false) }))
      );
    }
  };
  const set = async (on) => {
    try {
      const { deck: saved } = await api.put('/decks', { id: deck._id, share: on });
      deck.shareId = saved.shareId || null;
      onChange(deck.shareId);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  render();
}

// onRestore(versionDeck): carga esa versión en el editor (queda sin guardar hasta que el usuario guarde)
export async function openHistoryDialog({ deck, onRestore }) {
  const { body, close } = makeDialog('Historial de versiones');
  body.append(el('div', { class: 'spinner' }));
  try {
    const { versions } = await api.get(`/decks?id=${encodeURIComponent(deck._id)}&history=1`);
    clear(body);
    if (!versions.length) return body.append(el('p', { class: 'muted', text: 'Todavía no hay versiones anteriores: se guarda una cada vez que cambias las cartas y guardas (las últimas 15).' }));
    body.append(el('p', { class: 'muted', text: 'Versiones anteriores del mazo. Restaurar carga esa versión en el editor; no se guarda hasta que pulses "Guardar mazo".' }));
    const list = el('ul', { class: 'st-missing' });
    versions.forEach((v) =>
      list.append(
        el('li', { class: 'hist-row' },
          el('span', { text: `${new Date(v.savedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })} · ${v.cardCount} cartas · ${v.name}` }),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Restaurar', onClick: async () => {
            try {
              const { version } = await api.get(`/decks?id=${encodeURIComponent(deck._id)}&version=${v.index}`);
              onRestore(version);
              close();
            } catch (err) {
              toast(err.message, 'error');
            }
          } }))
      )
    );
    body.append(list);
  } catch (err) {
    clear(body);
    body.append(el('p', { class: 'tr-error', text: err.message }));
  }
}
