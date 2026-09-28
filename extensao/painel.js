// ══════════════════════════════════════════════════════════════════════════
//  painel.js — painel lateral da extensão DS-160 do Concierge.
//  Login OTP igual ao painel do concierge → lista os formulários recebidos
//  (/concierge/ds160) → para o cliente escolhido, mostra cada resposta pronta
//  para o DS-160 e preenche no site com um clique (ou todas da página).
//  Dados do cliente ficam só na memória do painel; no navegador ficam apenas
//  o token de sessão, as marcações de "preenchido" e as traduções da sessão.
// ══════════════════════════════════════════════════════════════════════════
(function () {
'use strict';

var PROXY = 'https://cdv-proxy-production.up.railway.app';
var M = window.DS160Mapa;

var sessao = null;          // { token, email }
var registros = [];         // formulários recebidos
var atual = null;           // registro aberto
var itens = [];             // itens montados pelo mapa.js
var feitos = {};            // itemId → true
var traducoes = {};         // itemId → texto em inglês
var erros = {};             // itemId → última mensagem de erro
var existentes = {};        // sufixo → true (campos da página aberta)
var abaId = null;
var ocupado = false;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function toast(msg, tipo) {
  var t = $('toast');
  t.textContent = msg; t.className = 'toast on ' + (tipo || '');
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
}
function mostrar(vista) {
  ['v-login', 'v-lista', 'v-cliente'].forEach(function (v) { $(v).hidden = v !== vista; });
  $('btn-sair').hidden = vista === 'v-login';
}

// ── armazenamento ─────────────────────────────────────────────────────────
function lerLocal(chave) { return chrome.storage.local.get(chave).then(function (o) { return o[chave]; }); }
function gravarLocal(chave, v) { var o = {}; o[chave] = v; return chrome.storage.local.set(o); }
function lerSessao(chave) { return chrome.storage.session.get(chave).then(function (o) { return o[chave]; }).catch(function () { return undefined; }); }
function gravarSessao(chave, v) { var o = {}; o[chave] = v; return chrome.storage.session.set(o).catch(function () {}); }

// ── proxy ─────────────────────────────────────────────────────────────────
function api(caminho, corpo) {
  var opts = { method: corpo ? 'POST' : 'GET', headers: {}, cache: 'no-store' };
  if (sessao && sessao.token) opts.headers['X-CDV-Auth'] = sessao.token;
  if (corpo) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
  return fetch(PROXY + caminho, opts).then(function (r) {
    if (r.status === 401 && caminho.indexOf('/concierge/') === 0) { sair(true); throw new Error('Sessão expirada. Entre de novo.'); }
    return r.json().catch(function () { return { ok: false, erro: 'Resposta inválida do servidor (' + r.status + ')' }; });
  });
}

// ── login ─────────────────────────────────────────────────────────────────
var emailLogin = '';
function msgLogin(t, tipo) { var m = $('login-msg'); m.textContent = t || ''; m.className = 'msg ' + (tipo || ''); }

function enviarCodigo() {
  var email = $('login-email').value.trim().toLowerCase();
  if (email.indexOf('@') < 1) return msgLogin('Digite um e-mail válido.', 'err');
  var b = $('login-enviar'); b.disabled = true; b.textContent = 'Enviando…';
  api('/admin/enviar-codigo', { email: email, app: 'concierge' }).then(function (d) {
    if (!d.ok) return msgLogin(d.motivo === 'nao_autorizado' ? 'E-mail sem autorização de acesso.' : 'Não foi possível enviar o código.', 'err');
    emailLogin = email;
    $('login-etapa-email').hidden = true; $('login-etapa-codigo').hidden = false;
    msgLogin(d.dev ? 'Modo dev: código no log do servidor.' : 'Código enviado para ' + email, 'ok');
    $('login-codigo').focus();
  }).catch(function () { msgLogin('Erro de conexão. Tente de novo.', 'err'); })
    .then(function () { b.disabled = false; b.textContent = 'Enviar código'; });
}

function validarCodigo() {
  var codigo = $('login-codigo').value.replace(/\D/g, '');
  if (codigo.length < 6) return msgLogin('Digite os 6 dígitos.', 'err');
  var b = $('login-validar'); b.disabled = true; b.textContent = 'Verificando…';
  api('/admin/verificar-codigo', { email: emailLogin, codigo: codigo, app: 'concierge' }).then(function (d) {
    if (d.ok && d.conciergeToken) {
      sessao = { token: d.conciergeToken, email: emailLogin };
      return gravarLocal('sessao', sessao).then(abrirLista);
    }
    var msgs = { expirado: 'Código expirado. Peça outro.', invalido: 'Código incorreto.', nao_encontrado: 'Peça um novo código.', nao_autorizado: 'E-mail sem autorização de acesso.' };
    msgLogin(msgs[d.motivo] || 'Não foi possível validar.', 'err');
  }).catch(function () { msgLogin('Erro de conexão. Tente de novo.', 'err'); })
    .then(function () { b.disabled = false; b.textContent = 'Entrar'; });
}

function sair(expirou) {
  sessao = null; atual = null; registros = []; itens = [];
  chrome.storage.local.remove('sessao');
  $('login-etapa-email').hidden = false; $('login-etapa-codigo').hidden = true; $('login-codigo').value = '';
  msgLogin(expirou ? 'Sessão expirada. Entre de novo.' : '', expirou ? 'err' : '');
  mostrar('v-login');
}

// ── lista de formulários ──────────────────────────────────────────────────
function abrirLista() {
  mostrar('v-lista');
  $('lista').innerHTML = '<div class="vazio-lista">Carregando…</div>';
  return api('/concierge/ds160').then(function (d) {
    if (!d.ok) throw new Error(d.erro || 'Não foi possível carregar.');
    registros = d.data || [];
    renderLista();
  }).catch(function (e) { $('lista').innerHTML = '<div class="vazio-lista">' + esc(e.message) + '</div>'; });
}

function renderLista() {
  var q = M.semAcento($('busca').value).toLowerCase().trim();
  var l = registros.slice().sort(function (a, b) {
    if ((a.status === 'novo') !== (b.status === 'novo')) return a.status === 'novo' ? -1 : 1;
    return String(b.recebidoEm).localeCompare(String(a.recebidoEm));
  }).filter(function (r) {
    if (!q) return true;
    var s = r.resumo || {};
    return M.semAcento((s.nome || '') + ' ' + (s.email || '') + ' ' + (s.passaporte || '')).toLowerCase().indexOf(q) > -1;
  });
  if (!l.length) { $('lista').innerHTML = '<div class="vazio-lista">' + (registros.length ? 'Nada encontrado.' : 'Nenhum formulário recebido ainda.') + '</div>'; return; }
  $('lista').innerHTML = l.map(function (r) {
    var s = r.resumo || {};
    var feito = r.status === 'preenchido';
    var chegada = s.chegada ? s.chegada.split('-').reverse().join('/') : '';
    return '<div class="form-row' + (feito ? ' feito' : '') + '" data-id="' + esc(r.id) + '">'
      + '<div style="flex:1;min-width:0"><div class="nome">' + esc(s.nome || '—') + '</div>'
      + '<div class="muted">' + esc(s.email || '') + (chegada ? ' · 🛫 ' + esc(chegada) : '')
      + ' · recebido ' + esc(String(r.recebidoEm || '').slice(0, 10).split('-').reverse().join('/')) + '</div></div>'
      + '<span class="tag' + (feito ? '' : ' novo') + '">' + (feito ? 'preenchido' : 'novo') + '</span></div>';
  }).join('');
}

// ── cliente ───────────────────────────────────────────────────────────────
function abrirCliente(id) {
  atual = null;
  for (var i = 0; i < registros.length; i++) if (registros[i].id === id) atual = registros[i];
  if (!atual) return;
  if (!atual.dados) { toast('Este formulário não tem os dados estruturados.', 'err'); return; }
  itens = M.montarItens(atual.dados);
  erros = {}; existentes = {};
  Promise.all([lerLocal('feitos:' + id), lerSessao('tr:' + id)]).then(function (v) {
    feitos = v[0] || {};
    traducoes = v[1] || {};
    var s = atual.resumo || {};
    $('cliente-nome').textContent = s.nome || '—';
    $('cliente-info').textContent = [s.passaporte ? 'Passaporte ' + s.passaporte : '', s.consulado || '', s.chegada ? '🛫 ' + s.chegada.split('-').reverse().join('/') : ''].filter(Boolean).join(' · ');
    $('btn-concluir').textContent = atual.status === 'preenchido' ? '↺ Reabrir no painel' : '✓ Marcar como preenchido';
    mostrar('v-cliente');
    renderCliente();
    sondar();
  });
}

function valorItem(it) {
  if (it.tr) return traducoes[it.id] || '';
  return it.mostra;
}
function camposProntos(it) {
  return (it.campos || []).map(function (c) {
    if (c.v === null && it.tr) return { s: c.s, t: c.t, v: traducoes[it.id] || '' };
    return c;
  });
}
function podePreencher(it) {
  if (!it.campos || !it.campos.length) return false;
  if (it.tr && !traducoes[it.id]) return false;
  return true;
}
function naPagina(it) {
  return (it.campos || []).some(function (c) { return existentes[c.s]; });
}

function htmlItem(it) {
  var feito = !!feitos[it.id];
  var val = valorItem(it);
  var h = '<div class="item' + (feito ? ' feito' : '') + (it.alerta ? ' alerta' : '') + '" data-item="' + esc(it.id) + '">';
  h += '<div class="r">' + esc(it.r) + '</div>';
  if (it.pt && it.pt !== '—') h += '<div class="pt">' + esc(it.pt) + '</div>';
  if (it.tr && !traducoes[it.id]) {
    h += '<div class="valor vazio" data-copiar="' + esc(it.id) + '">' + esc(it.tr) + '</div>';
  } else {
    h += '<div class="valor' + (val ? '' : ' vazio') + '" data-copiar="' + esc(it.id) + '">' + esc(val || '(sem resposta)') + '</div>';
  }
  h += '<div class="botoes">';
  if (it.tr && !traducoes[it.id]) h += '<button class="btn btn-ghost" data-acao="traduzir" title="Traduzir para o inglês">🌐</button>';
  if (podePreencher(it)) h += '<button class="btn btn-accent" data-acao="preencher" title="Preencher no site">' + (feito ? '↻' : 'Preencher') + '</button>';
  if (val) h += '<button class="btn btn-ghost" data-acao="manual" title="Colar no campo clicado no site">↘</button>';
  h += '</div>';
  if (it.tr && traducoes[it.id]) h += '<div class="tr-orig">PT: ' + esc(it.tr) + '</div>';
  if (it.alerta) h += '<div class="aviso">⚠ ' + esc(it.alerta) + '</div>';
  if (it.nota) h += '<div class="nota">' + esc(it.nota) + '</div>';
  if (erros[it.id]) h += '<div class="erro">' + esc(erros[it.id]) + '</div>';
  return h + '</div>';
}

function renderCliente() {
  var total = itens.length, ok = itens.filter(function (it) { return feitos[it.id]; }).length;
  $('progresso').textContent = ok + ' de ' + total + ' preenchidos';

  var daPagina = itens.filter(naPagina);
  $('pagina-itens').innerHTML = daPagina.length ? daPagina.map(htmlItem).join('') : '';
  var pendentes = daPagina.filter(function (it) { return !feitos[it.id] && podePreencher(it) && !it.alerta; });
  $('btn-pagina').disabled = !pendentes.length || ocupado;
  $('btn-pagina').textContent = pendentes.length ? 'Preencher esta página (' + pendentes.length + ')' : 'Preencher esta página';

  var html = '';
  M.SECOES.forEach(function (sec) {
    var doSec = itens.filter(function (it) { return it.secao === sec && !naPagina(it); });
    if (!doSec.length) return;
    var okSec = doSec.filter(function (it) { return feitos[it.id]; }).length;
    html += '<div class="secao-h"><span>' + esc(sec) + '</span><span>' + okSec + '/' + doSec.length + '</span></div>';
    html += doSec.map(htmlItem).join('');
  });
  $('secoes').innerHTML = html;
}

// ── aba do DS-160 ─────────────────────────────────────────────────────────
function acharAba() {
  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(function (abas) {
    var a = abas && abas[0];
    if (a && /^https:\/\/ceac\.state\.gov\//.test(a.url || '')) { abaId = a.id; return a; }
    abaId = null;
    return null;
  });
}

function enviar(msg) {
  if (abaId == null) return Promise.reject(new Error('Abra o DS-160 (ceac.state.gov) na aba ativa.'));
  return chrome.tabs.sendMessage(abaId, msg).catch(function () {
    // Aba aberta antes de instalar a extensão: injeta o script e tenta de novo.
    return chrome.scripting.executeScript({ target: { tabId: abaId }, files: ['content.js'] })
      .then(function () { return chrome.tabs.sendMessage(abaId, msg); });
  });
}

function sondar() {
  if (!atual) return Promise.resolve();
  return acharAba().then(function (aba) {
    if (!aba) {
      existentes = {};
      $('pagina-titulo').textContent = 'Página do DS-160';
      $('pagina-status').textContent = 'Abra o DS-160 (ceac.state.gov) na aba ativa.';
      renderCliente();
      return;
    }
    return enviar({ tipo: 'ds160-sondar', sufixos: M.sufixos(itens) }).then(function (r) {
      existentes = {};
      (r && r.existentes || []).forEach(function (s) { existentes[s] = true; });
      var n = itens.filter(naPagina).length;
      $('pagina-titulo').textContent = (r && r.titulo) || 'Página do DS-160';
      $('pagina-status').textContent = n ? n + ' resposta(s) desta página' : 'Nenhuma resposta do cliente para os campos desta página.';
      renderCliente();
    });
  }).catch(function (e) { $('pagina-status').textContent = e.message; renderCliente(); });
}

// Espera a página do DS-160 recarregar (postback do ASP.NET).
var esperaCarga = null;
function aguardarCarga(ms) {
  return new Promise(function (resolve) {
    var t = setTimeout(function () { esperaCarga = null; resolve(false); }, ms || 15000);
    esperaCarga = function () { clearTimeout(t); esperaCarga = null; setTimeout(function () { resolve(true); }, 350); };
  });
}
chrome.runtime.onMessage.addListener(function (msg, rem) {
  if (!msg || msg.tipo !== 'ds160-pagina') return;
  if (rem.tab && abaId != null && rem.tab.id !== abaId) return;
  if (esperaCarga) esperaCarga();
  else if (!ocupado) sondar();
});
chrome.tabs.onActivated.addListener(function () { if (!ocupado) sondar(); });

// Preenche os campos de um item; se a página recarregar no meio, espera e segue.
function preencherItem(it) {
  var campos = camposProntos(it);
  var falhas = [];
  function passo(lista, tentativas) {
    return enviar({ tipo: 'ds160-preencher', campos: lista }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.erro) || 'Falha ao preencher.');
      (r.resultados || []).forEach(function (x) { if (!x.ok) falhas.push(x.erro || x.s); });
      if (r.postback) {
        return aguardarCarga().then(function () {
          if (r.pendentes && r.pendentes.length && tentativas < 8) return passo(r.pendentes, tentativas + 1);
        });
      }
    });
  }
  return passo(campos, 0).then(function () {
    if (falhas.length) {
      erros[it.id] = 'Não preencheu: ' + falhas.join('; ') + '. Use ↘ no campo certo.';
      return false;
    }
    delete erros[it.id];
    feitos[it.id] = true;
    return gravarLocal('feitos:' + atual.id, feitos).then(function () { return true; });
  }).catch(function (e) { erros[it.id] = e.message; return false; });
}

function acharItem(id) { for (var i = 0; i < itens.length; i++) if (itens[i].id === id) return itens[i]; return null; }

function preencherUm(it) {
  if (ocupado) return;
  ocupado = true;
  acharAba().then(function () { return preencherItem(it); }).then(function (ok) {
    toast(ok ? '✓ ' + it.r : 'Não foi possível preencher tudo — veja o item.', ok ? 'ok' : 'err');
  }).then(function () { ocupado = false; return sondar(); });
}

function filaDaPagina() {
  return itens.filter(function (it) { return naPagina(it) && !feitos[it.id] && !erros[it.id] && podePreencher(it) && !it.alerta; });
}

// Preenche tudo o que a página mostra; se um "Yes" abrir campos novos,
// faz outra rodada com eles (até 4).
function preencherPagina() {
  if (ocupado || !filaDaPagina().length) return;
  ocupado = true;
  $('btn-pagina').disabled = true;
  var ok = 0, falha = 0;
  function rodada(n) {
    var fila = filaDaPagina();
    if (!fila.length || n > 4) return Promise.resolve();
    var p = acharAba();
    fila.forEach(function (it, i) {
      p = p.then(function () {
        $('btn-pagina').textContent = 'Preenchendo ' + (i + 1) + '/' + fila.length + '…';
        return preencherItem(it).then(function (r) { if (r) ok++; else falha++; });
      });
    });
    return p.then(sondar).then(function () { return rodada(n + 1); });
  }
  rodada(1).then(function () {
    toast(ok + ' preenchido(s)' + (falha ? ' · ' + falha + ' com problema' : '') + '. Revise e clique em Next no site.', falha ? 'err' : 'ok');
  }).then(function () { ocupado = false; return sondar(); });
}

function colarManual(it) {
  var v = valorItem(it);
  if (!v) return;
  acharAba().then(function () { return enviar({ tipo: 'ds160-manual', valor: v }); }).then(function (r) {
    if (r && r.ok) { toast('↘ Colado', 'ok'); feitos[it.id] = true; gravarLocal('feitos:' + atual.id, feitos); renderCliente(); }
    else toast((r && r.erro) || 'Clique primeiro no campo do site.', 'err');
  }).catch(function (e) { toast(e.message, 'err'); });
}

function copiar(it) {
  var v = valorItem(it) || it.tr || '';
  if (!v) return;
  navigator.clipboard.writeText(v).then(function () { toast('📋 Copiado', 'ok'); });
}

// ── tradução ──────────────────────────────────────────────────────────────
function traduzir(lista) {
  lista = lista.filter(function (it) { return it.tr && !traducoes[it.id]; });
  if (!lista.length) { toast('Nada para traduzir.', 'ok'); return Promise.resolve(); }
  toast('Traduzindo ' + lista.length + ' texto(s)…');
  return api('/concierge/ia/traduzir-ds160', { textos: lista.map(function (it) { return it.tr; }) }).then(function (d) {
    if (!d.ok || !Array.isArray(d.traducoes)) throw new Error(d.erro || 'Falha na tradução.');
    lista.forEach(function (it, i) { if (d.traducoes[i]) traducoes[it.id] = String(d.traducoes[i]); });
    return gravarSessao('tr:' + atual.id, traducoes).then(function () { toast('🌐 Tradução pronta — revise antes de preencher.', 'ok'); renderCliente(); });
  }).catch(function (e) { toast(e.message, 'err'); });
}

function alternarStatus() {
  if (!atual) return;
  var acao = atual.status === 'preenchido' ? 'novo' : 'preenchido';
  api('/concierge/ds160/status', { id: atual.id, acao: acao }).then(function (d) {
    if (!d.ok) throw new Error(d.erro || 'falha');
    atual.status = acao;
    $('btn-concluir').textContent = acao === 'preenchido' ? '↺ Reabrir no painel' : '✓ Marcar como preenchido';
    toast(acao === 'preenchido' ? '✅ Marcado como preenchido' : '↺ Reaberto', 'ok');
  }).catch(function (e) { toast(e.message, 'err'); });
}

// ── eventos ───────────────────────────────────────────────────────────────
$('login-enviar').addEventListener('click', enviarCodigo);
$('login-validar').addEventListener('click', validarCodigo);
$('login-email').addEventListener('keydown', function (e) { if (e.key === 'Enter') enviarCodigo(); });
$('login-codigo').addEventListener('keydown', function (e) { if (e.key === 'Enter') validarCodigo(); });
$('login-voltar').addEventListener('click', function () { $('login-etapa-email').hidden = false; $('login-etapa-codigo').hidden = true; msgLogin(''); });
$('btn-sair').addEventListener('click', function () { sair(false); });
$('btn-recarregar').addEventListener('click', abrirLista);
$('busca').addEventListener('input', renderLista);
$('lista').addEventListener('click', function (e) { var r = e.target.closest('.form-row'); if (r) abrirCliente(r.getAttribute('data-id')); });
$('btn-voltar').addEventListener('click', function () { atual = null; renderLista(); mostrar('v-lista'); });
$('btn-pagina').addEventListener('click', preencherPagina);
$('btn-traduzir').addEventListener('click', function () { traduzir(itens); });
$('btn-concluir').addEventListener('click', alternarStatus);
document.getElementById('v-cliente').addEventListener('click', function (e) {
  var box = e.target.closest('.item');
  if (!box) return;
  var it = acharItem(box.getAttribute('data-item'));
  if (!it) return;
  var b = e.target.closest('[data-acao]');
  if (b) {
    var a = b.getAttribute('data-acao');
    if (a === 'preencher') preencherUm(it);
    else if (a === 'manual') colarManual(it);
    else if (a === 'traduzir') traduzir([it]);
    return;
  }
  if (e.target.closest('[data-copiar]')) copiar(it);
});

// ── início ────────────────────────────────────────────────────────────────
lerLocal('sessao').then(function (s) {
  if (!s || !s.token) { mostrar('v-login'); return; }
  sessao = s;
  return fetch(PROXY + '/concierge-auth/status', { headers: { 'X-CDV-Auth': s.token }, cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.ok) abrirLista(); else sair(true); })
    .catch(function () { abrirLista(); });
});
})();
