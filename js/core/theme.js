/* Тема оформлення: світла / чорна. Підключається в <head> до стилів, щоб не було «спалаху».
 * Вибір зберігається на пристрої (localStorage); за замовчуванням — як у системі. */
window.SK = window.SK || {};
SK.theme = (function () {
  var KEY = 'sk9_theme', listeners = [];
  var host = document.documentElement.getAttribute('data-theme');   // тема, задана оточенням (напр. онлайн-переглядачем)
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { var s = saved(); return s === 'dark' || s === 'light' ? s : host === 'dark' || host === 'light' ? host : (mq && mq.matches ? 'dark' : 'light'); }
  function apply() {
    var t = current();
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#050607' : '#1f6fb2');
    var b = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < b.length; i++) { b[i].textContent = t === 'dark' ? '☀' : '☾'; b[i].title = t === 'dark' ? 'Світла тема' : 'Чорна тема'; }
    listeners.forEach(function (fn) { try { fn(t === 'dark'); } catch (e) { } });
  }
  function toggle() { try { localStorage.setItem(KEY, current() === 'dark' ? 'light' : 'dark'); } catch (e) { } apply(); }
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!saved()) apply(); });
  document.documentElement.setAttribute('data-theme', current());
  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-theme-toggle]')) toggle(); });
    apply();
  });
  return { isDark: function () { return current() === 'dark'; }, toggle: toggle, on: function (fn) { listeners.push(fn); } };
})();
