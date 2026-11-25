/* Тема оформлення: темна («диспетчерська») / світла. Підключається в <head> до стилів, щоб не було «спалаху».
 * Вибір зберігається на пристрої (localStorage). За замовчуванням — атрибут <html data-theme-default="…">
 * (панель за замовчуванням — темна). */
window.SK = window.SK || {};
SK.theme = (function () {
  var KEY = 'sk9_theme', listeners = [];
  var host = document.documentElement.getAttribute('data-theme');   // тема, задана оточенням (напр. онлайн-переглядачем)
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var def = document.documentElement.getAttribute('data-theme-default');   // 'dark' | 'light' | 'system'
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { var s = saved(); return s === 'dark' || s === 'light' ? s : host === 'dark' || host === 'light' ? host : def === 'dark' || def === 'light' ? def : (mq && mq.matches ? 'dark' : 'light'); }
  function apply() {
    var t = current();
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0a0f14' : '#0e7490');
    var b = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < b.length; i++) {
      if (SK.icon) b[i].innerHTML = SK.icon(t === 'dark' ? 'sun' : 'moon'); else b[i].textContent = t === 'dark' ? '☀' : '☾';
      b[i].title = t === 'dark' ? 'Світла тема' : 'Темна тема';
    }
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
