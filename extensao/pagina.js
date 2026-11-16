// ══════════════════════════════════════════════════════════════════════════
//  pagina.js — roda no contexto da própria página do DS-160 (world MAIN),
//  antes dos scripts do site (document_start). Só faz uma coisa: deixa o
//  modo automático desligar o aviso "Sair do site?" (beforeunload) quando ele
//  mesmo clica em Next. Sem o sinal da extensão, o aviso funciona normalmente.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__ds160CdvPagina) return;
  window.__ds160CdvPagina = true;
  var livre = false;
  var addOrig = EventTarget.prototype.addEventListener;
  var nativo = Object.getOwnPropertyDescriptor(window, 'onbeforeunload') ||
    Object.getOwnPropertyDescriptor(Window.prototype, 'onbeforeunload');

  // Ouvintes de beforeunload registrados pelo site passam a respeitar o sinal.
  EventTarget.prototype.addEventListener = function (tipo, fn, opc) {
    if (this === window && tipo === 'beforeunload' && typeof fn === 'function') {
      var original = fn;
      fn = function () { if (livre) return; return original.apply(this, arguments); };
    }
    return addOrig.call(this, tipo, fn, opc);
  };

  // window.onbeforeunload = ... também.
  var h = null;
  try {
    Object.defineProperty(window, 'onbeforeunload', {
      configurable: true,
      get: function () { return h; },
      set: function (fn) { h = typeof fn === 'function' ? fn : null; }
    });
    addOrig.call(window, 'beforeunload', function (e) {
      if (livre || !h) return;
      var r = h.call(window, e);
      if (r !== undefined && r !== null) { e.preventDefault(); e.returnValue = r; return r; }
    });
  } catch (e) {}

  // Sinal mandado pelo content.js logo antes do Next do modo automático.
  addOrig.call(window, 'ds160cdv-livre', function () {
    livre = true;
    h = null;
    try { if (nativo && nativo.set) nativo.set.call(window, null); } catch (e) {}
    try { if (document.body) document.body.removeAttribute('onbeforeunload'); } catch (e) {}
  });
})();
