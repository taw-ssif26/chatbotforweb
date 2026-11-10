/* Runs first (in <head>) so the page never flashes the wrong theme. Choice is 'light', 'dark' or 'auto' (follow the device). */
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
  window.setTheme = function (v) { try { localStorage.setItem('theme', v); } catch (e) {} document.documentElement.setAttribute('data-theme', v); };
  window.getTheme = function () { return document.documentElement.getAttribute('data-theme') || 'auto'; };
})();
