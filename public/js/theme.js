// Tema claro/oscuro. Se carga como script normal en <head> para aplicarse antes de pintar (sin parpadeo).
// Sin elección guardada se sigue el tema del sistema.
(function () {
  var KEY = 'tcg.theme';
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { return stored() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f4f6fb' : '#000000');
  }
  apply(current());
  window.tcgTheme = {
    get: current,
    toggle: function () {
      var next = current() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, next); } catch (e) { /* sin almacenamiento */ }
      apply(next);
      return next;
    },
  };
})();
