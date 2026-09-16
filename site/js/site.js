/* Syntax Routines · landing page. Tudo aqui e progressivo: sem JS a pagina nasce inteira
   visivel (html sem [data-js]) e o botao de copiar simplesmente nao aparece. */
(function () {
  'use strict';
  document.documentElement.setAttribute('data-js', '');

  /* reveal por scroll (copiado de frontend-expert/assets/effects/reveal.js) */
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.fx-reveal');
  document.querySelectorAll('.fx-reveal-group').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (c, i) { c.style.setProperty('--fx-i', String(i)); });
  });
  if (els.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' });
      els.forEach(function (el) { io.observe(el); });
    }
  }

  /* grade de dias: numera as celulas acesas para o pulso em cascata */
  document.querySelectorAll('.lp-days.is-live').forEach(function (grid) {
    Array.prototype.forEach.call(grid.querySelectorAll('.is-on'), function (cell, i) {
      cell.style.setProperty('--i', String(i));
    });
  });

  /* copiar o comando de instalacao, um botao por bloco (so quando a API existe) */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    if (!navigator.clipboard) return;
    btn.hidden = false;
    var label = btn.textContent;
    btn.addEventListener('click', function () {
      var src = document.getElementById(btn.getAttribute('data-copy'));
      if (!src) return;
      navigator.clipboard.writeText(src.textContent.trim()).then(function () {
        btn.textContent = btn.getAttribute('data-copied') || label;
        setTimeout(function () { btn.textContent = label; }, 1800);
      });
    });
  });

  /* particulas do hero: pontos de luz subindo, so quando o movimento e bem-vindo */
  if (!reduce) {
    document.querySelectorAll('.fx-particles').forEach(function (box) {
      var total = parseInt(box.getAttribute('data-particles') || '16', 10);
      for (var i = 0; i < total; i++) {
        var dot = document.createElement('i');
        dot.style.left = (Math.random() * 100).toFixed(1) + '%';
        dot.style.bottom = (-10 - Math.random() * 30).toFixed(1) + '%';
        dot.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + 's';
        dot.style.animationDelay = (-Math.random() * 12).toFixed(1) + 's';
        dot.style.opacity = (0.22 + Math.random() * 0.4).toFixed(2);
        box.appendChild(dot);
      }
    });
  }
})();
