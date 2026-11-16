// ══════════════════════════════════════════════════════════════════════════
//  content.js — roda dentro do site do DS-160 (ceac.state.gov).
//  Não decide nada: só obedece ao painel lateral da extensão.
//    ds160-sondar    { sufixos[] }  → quais campos existem nesta página
//    ds160-preencher { campos[] }   → preenche; para no primeiro que recarrega a página
//    ds160-manual    { valor }      → cola o valor no último campo clicado
//    ds160-ping                     → responde se a página está pronta
//    ds160-avancar                  → clica em "Next" (o site salva a página)
//  Linha que ainda não existe (2º acompanhante, 2ª escola…): clica sozinho
//  em "Add Another" daquela lista e continua depois do recarregamento.
//  Ao carregar, avisa o painel (a página do DS-160 recarrega a cada postback).
// ══════════════════════════════════════════════════════════════════════════
(function () {
'use strict';
if (window.__ds160CdvCarregado) return;
window.__ds160CdvCarregado = true;

var PREFIXO = 'ctl00_SiteContentPlaceHolder_FormView1_';
// Identifica esta carga da página: muda a cada recarregamento (postback ou Next).
var CARGA = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
var ultimoCampo = null;

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function acharCampo(sufixo, campo) {
  var el = document.getElementById(PREFIXO + sufixo);
  if (el) return el;
  // Algumas páginas usam outro contêiner (ex.: FormView1 → outro prefixo).
  var lista = document.querySelectorAll('[id$="_' + CSS.escape(sufixo) + '"]');
  if (lista.length === 1) return lista[0];
  return campo && campo.bloco ? pelaPosicao(campo) : null;
}

// Plano B para linhas de endereço cujo id não bate: acha o bloco pelo campo
// vizinho conhecido (ex.: City) e pega a caixa de texto na posição pedida
// (0 = linha 1, 1 = linha 2), sempre antes do vizinho.
function pelaPosicao(campo) {
  var ancora = document.getElementById(PREFIXO + campo.bloco);
  if (!ancora) return null;
  var no = ancora.parentElement;
  for (var n = 0; no && n < 8; n++, no = no.parentElement) {
    var caixas = Array.prototype.filter.call(no.querySelectorAll('input[type=text], input:not([type])'), function (x) { return visivel(x) && !x.disabled; });
    var i = caixas.indexOf(ancora);
    if (i >= 2 && campo.pos < i) return caixas[campo.pos] || null;
  }
  return null;
}

function visivel(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

// O ASP.NET dispara __doPostBack (recarrega a página) no onchange/onclick
// de vários campos — depois deles os seguintes ainda não existem.
function fazPostback(el) {
  var a = (el.getAttribute('onchange') || '') + ' ' + (el.getAttribute('onclick') || '');
  if (/__doPostBack|setTimeout/.test(a)) return true;
  var pai = el.closest('table, span');
  if (pai && el.type === 'radio') {
    var b = (pai.getAttribute('onchange') || '') + (pai.getAttribute('onclick') || '');
    if (/__doPostBack|setTimeout/.test(b)) return true;
  }
  return false;
}

function marcar(el, ok) {
  var alvo = (el.type === 'radio' || el.type === 'checkbox') ? (el.parentElement || el) : el;
  alvo.style.transition = 'background-color .3s, outline-color .3s';
  alvo.style.backgroundColor = ok ? '#fff6b0' : '#ffd6d6';
  alvo.style.outline = '2px solid ' + (ok ? '#e0b400' : '#d93636');
  alvo.style.outlineOffset = '1px';
}

function disparar(el, tipos) {
  tipos.forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
}

function escolherOpcao(sel, candidatos) {
  var ops = Array.prototype.slice.call(sel.options);
  for (var i = 0; i < candidatos.length; i++) {
    var c = String(candidatos[i]);
    var contem = c.charAt(0) === '~';
    var alvo = norm(contem ? c.slice(1) : c);
    if (!alvo) continue;
    for (var j = 0; j < ops.length; j++) {
      var v = norm(ops[j].value), t = norm(ops[j].text);
      if (!v && !t) continue;
      if (contem ? (t.indexOf(alvo) > -1) : (v === alvo || t === alvo)) return ops[j];
    }
  }
  return null;
}

function aplicar(el, campo) {
  if (el.disabled) return { ok: false, erro: 'campo desabilitado' };
  if (campo.t === 'radio') {
    if (!el.checked) el.click();
    return { ok: el.checked };
  }
  if (campo.t === 'check') {
    var quer = campo.v !== false;
    if (el.checked !== quer) el.click();
    return { ok: el.checked === quer };
  }
  if (el.tagName === 'SELECT') {
    var cand = Array.isArray(campo.v) ? campo.v : [campo.v];
    var op = escolherOpcao(el, cand);
    if (!op) return { ok: false, erro: 'opção não encontrada: ' + cand.join(' | ') };
    if (el.value !== op.value) { el.value = op.value; disparar(el, ['input', 'change']); }
    return { ok: true };
  }
  var val = campo.v == null ? '' : String(campo.v);
  if (el.maxLength > 0 && val.length > el.maxLength) val = val.slice(0, el.maxLength);
  el.focus();
  el.value = val;
  disparar(el, ['input', 'change']);
  el.blur();
  return { ok: el.value === val };
}

// "Add Another" da lista a que o sufixo pertence (ex.: DListAlias_ctl01_… → link
// InsertButton da lista DListAlias). Tenta no máximo 2 vezes por linha.
function adicionarLinha(sufixo) {
  var m = /^(.*?)_ctl(\d{2})_(.*)$/.exec(sufixo);
  if (!m || m[2] === '00') return false;
  var chave = 'ds160cdv-add:' + m[1] + ':' + m[2];
  var n = 0;
  try { n = Number(sessionStorage.getItem(chave)) || 0; } catch (e) {}
  if (n >= 2) return false;
  var links = Array.prototype.slice.call(document.querySelectorAll('a[id^="' + PREFIXO + m[1] + '_ctl"]'))
    .filter(function (a) { return visivel(a) && (/InsertButton/i.test(a.id) || /add\s*another/i.test(a.textContent)); });
  var link = links[links.length - 1];
  if (!link) return false;
  try { sessionStorage.setItem(chave, String(n + 1)); } catch (e) {}
  link.click();
  return true;
}

function preencher(campos) {
  var res = [];
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i];
    var el = acharCampo(c.s, c);
    if (!el && adicionarLinha(c.s)) {
      return { resultados: res, postback: true, pendentes: campos.slice(i), adicionou: true };
    }
    if (!el && c.opc) { res.push({ s: c.s, ok: true, ausente: true }); continue; }
    if (!el) { res.push({ s: c.s, ok: false, erro: 'campo não está nesta página' }); continue; }
    var pb = fazPostback(el);
    var antes = el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value;
    var r = aplicar(el, c);
    marcar(el, r.ok);
    r.s = c.s;
    if (el.id !== PREFIXO + c.s) r.id = el.id;
    res.push(r);
    var depois = el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value;
    if (pb && r.ok && antes !== depois) {
      return { resultados: res, postback: true, pendentes: campos.slice(i + 1) };
    }
  }
  return { resultados: res, postback: false, pendentes: [] };
}

// Botão "Next" do rodapé de cada página.
function botaoNext() {
  var b = document.getElementById('ctl00_SiteContentPlaceHolder_UpdateButton3');
  if (b && visivel(b)) return b;
  var l = document.querySelectorAll('input[type=submit], input[type=button], button, a');
  for (var i = 0; i < l.length; i++) {
    var t = String(l[i].value || l[i].textContent || '').trim();
    if (/^next\b/i.test(t) && visivel(l[i])) return l[i];
  }
  return null;
}

// Mensagens de validação que o site mostra depois do Next.
function errosDaPagina() {
  var sel = '[id*="ValidationSummary"], .validation-summary-errors, .error-message';
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
    if (!visivel(el)) return;
    var t = String(el.innerText || el.textContent || '').replace(/\s+\n/g, '\n').trim();
    if (t) t.split(/\n+/).forEach(function (x) { x = x.trim(); if (x && out.indexOf(x) < 0) out.push(x); });
  });
  return out.slice(0, 12);
}

function infoPagina() {
  var txt = String((document.body && (document.body.innerText || document.body.textContent)) || '');
  var m = /Application ID\s*:?\s*([A-Z]{2}[0-9A-Z]{8})\b/.exec(txt);
  var p = location.pathname + location.search;
  return {
    appId: m ? m[1] : null,
    erros: errosDaPagina(),
    revisao: /\/review\/|review_|Photo|SignCertify|Sign_Certify|Confirmation/i.test(p),
    temNext: !!botaoNext()
  };
}

// Inventário dos campos da página (sem nenhum valor preenchido): id, tipo,
// rótulo e opções — para conferir o mapa.js com o site real.
function rotuloDe(el) {
  var l = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
  if (l && l.textContent.trim()) return l.textContent.replace(/\s+/g, ' ').trim().slice(0, 140);
  var proprio = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  var no = el.parentElement;
  for (var n = 0; no && n < 5; n++, no = no.parentElement) {
    var t = String(no.innerText || no.textContent || '').replace(/\s+/g, ' ').trim();
    if (proprio) t = t.replace(proprio, '').trim();
    if (t.length > 2) return t.slice(0, 140);
  }
  return '';
}
function inventario() {
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('input, select, textarea, a[id*="InsertButton"], a[id*="DeleteButton"]'), function (el) {
    var tipo = el.tagName === 'INPUT' ? (el.type || 'text') : el.tagName.toLowerCase();
    if (tipo === 'hidden' || !el.id) return;
    var o = { id: el.id.indexOf(PREFIXO) === 0 ? el.id.slice(PREFIXO.length) : el.id, tipo: tipo, visivel: visivel(el),
      rotulo: tipo === 'a' ? el.textContent.trim() : rotuloDe(el) };
    if (el.maxLength > 0) o.max = el.maxLength;
    if (tipo === 'radio' || tipo === 'checkbox') o.valor = el.value;
    if (tipo === 'select') {
      o.nOpcoes = el.options.length;
      o.opcoes = Array.prototype.slice.call(el.options, 0, 40).map(function (x) { return x.value + '=' + x.text; });
    }
    if (fazPostback(el)) o.postback = true;
    out.push(o);
  });
  return { url: location.pathname + location.search, titulo: (document.querySelector('h2') || {}).textContent || document.title, campos: out };
}

function colarManual(valor) {
  var el = ultimoCampo;
  if (!el || !document.contains(el)) return { ok: false, erro: 'Clique primeiro no campo do site.' };
  var r;
  if (el.tagName === 'SELECT') {
    r = aplicar(el, { t: 'select', v: [valor, '~' + valor] });
  } else if (el.type === 'radio' || el.type === 'checkbox') {
    r = { ok: false, erro: 'Para opções, use o botão Preencher ou clique direto no site.' };
  } else {
    r = aplicar(el, { t: 'text', v: valor });
  }
  if (r.ok) marcar(el, true);
  return r;
}

document.addEventListener('focusin', function (e) {
  var el = e.target;
  if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'submit' && el.type !== 'button') ultimoCampo = el;
}, true);

chrome.runtime.onMessage.addListener(function (msg, _rem, responder) {
  if (!msg || !msg.tipo) return;
  try {
    if (msg.tipo === 'ds160-ping') {
      responder({ ok: true, pronto: document.readyState === 'complete', carga: CARGA, url: location.href,
        existe: msg.sufixo ? !!acharCampo(msg.sufixo) : undefined });
    } else if (msg.tipo === 'ds160-sondar') {
      var existe = (msg.sufixos || []).filter(function (s) { var el = acharCampo(s); return el && visivel(el); });
      var h = document.querySelector('#ctl00_SiteContentPlaceHolder_ucNavigateOption_ucNavPanel_ctl00_lblHeader, h2, .PageHeader');
      responder(Object.assign({ ok: true, existentes: existe, url: location.href, titulo: h ? h.textContent.trim() : document.title }, infoPagina()));
    } else if (msg.tipo === 'ds160-preencher') {
      responder(Object.assign({ ok: true, carga: CARGA }, preencher(msg.campos || [])));
    } else if (msg.tipo === 'ds160-inventario') {
      responder(Object.assign({ ok: true }, inventario()));
    } else if (msg.tipo === 'ds160-avancar') {
      var b = botaoNext();
      if (!b) responder({ ok: false, erro: 'Botão "Next" não encontrado nesta página.' });
      else {
        try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('ds160cdv-add:') === 0) sessionStorage.removeItem(k); }); } catch (e) {}
        responder({ ok: true, carga: CARGA, url: location.href, texto: String(b.value || b.textContent || '').trim() });
        try { window.dispatchEvent(new CustomEvent('ds160cdv-livre')); } catch (e) {}
        setTimeout(function () {
          ['mousedown', 'mouseup'].forEach(function (t) { b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
          b.click();
          // Aplicação já completa: o site pergunta se volta à revisão ou segue para a próxima página.
          setTimeout(function () {
            var seguir = document.getElementById('ctl00_ucNavigateOption_ucNavPanel_ctl01_btnNextPageComplete');
            if (seguir && visivel(seguir)) seguir.click();
          }, 1500);
        }, 80);
      }
    } else if (msg.tipo === 'ds160-manual') {
      responder(colarManual(String(msg.valor || '')));
    }
  } catch (e) {
    responder({ ok: false, erro: e.message });
  }
  return true;
});

// Guarda o inventário sozinho a cada carga e a cada mudança da página (ex.: um
// "Yes" que abre campos novos), sem depender do painel estar acompanhando.
function guardarInventarioLocal() {
  try {
    var inv = inventario();
    var m = /node=([^&]+)/.exec(inv.url);
    var k = inv.url.split('?')[0] + (m ? '?node=' + m[1] : '');
    chrome.storage.local.get('inventario').then(function (o) {
      var tudo = o.inventario || {};
      var ids = {};
      ((tudo[k] && tudo[k].campos) || []).forEach(function (x) { ids[x.id] = x; });
      inv.campos.forEach(function (x) { ids[x.id] = x; });
      tudo[k] = { url: inv.url, titulo: inv.titulo, campos: Object.keys(ids).map(function (i) { return ids[i]; }), em: new Date().toISOString() };
      return chrome.storage.local.set({ inventario: tudo });
    }).catch(function () {});
  } catch (e) {}
}
var _invT = null;
function agendarInventario() { clearTimeout(_invT); _invT = setTimeout(guardarInventarioLocal, 1200); }
try { new MutationObserver(agendarInventario).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}

function avisarCarregou() {
  agendarInventario();
  try { chrome.runtime.sendMessage({ tipo: 'ds160-pagina', url: location.href }).catch(function () {}); } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avisarCarregou);
else avisarCarregou();
})();
