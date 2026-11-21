// Robô de check-in da Azul — roda em www.voeazul.com.br.
// Só age em aba aberta pelo robô (checkin-robo.js no background): pergunta ao
// background se esta aba tem um trabalho. Sem trabalho, não faz nada — o Davi
// pode usar o site da Azul normalmente.
//
// Fluxo conferido no site real em 21/11/2026 (reserva YWWJ2Q):
//   minhas-viagens?pnr=&origin=  → botão "Fazer check-in" do trecho
//   azulwebcheckin/selecao-trechos → marca o trecho → Prosseguir
//   azulwebcheckin/passageiros     → "Selecionar todos os passageiros" → Prosseguir
//   azulwebcheckin/review          → confere total R$ 0,00 → Prosseguir
//   azulwebcheckin/contato         → marca "Declaro que li e estou de acordo" → Finalizar check-in
//   azulwebcheckin/cartao-embarque → lê o QR (BCBP) de cada cartão
// Qualquer tela fora disso, cobrança ou dado faltando = para e devolve o motivo.
(function () {
  'use strict';
  if (window.__cdvCheckinAzul) return;
  window.__cdvCheckinAzul = true;

  var job = null;
  var feitos = {};          // passo → vezes executado nesta página
  var inicio = Date.now();
  var LIMITE_MS = 4 * 60 * 1000;
  var acabou = false;

  function dormir(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
  function visivel(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  function clicar(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    });
    el.click();
    return true;
  }
  function botaoPorTexto(re, raiz) {
    var bs = [].slice.call((raiz || document).querySelectorAll('button, a[role="button"], [role="button"]'));
    return bs.filter(function (b) { return visivel(b) && !b.disabled && re.test(txt(b) + ' ' + (b.getAttribute('aria-label') || '')); });
  }
  function textoPagina() { return document.body ? document.body.innerText : ''; }
  function dataBR(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }

  function fim(resultado) {
    if (acabou) return;
    acabou = true;
    chrome.runtime.sendMessage({ tipo: 'checkin-resultado', resultado: resultado });
  }
  function falha(motivo, definitivo) { fim({ ok: false, erro: motivo, definitivo: !!definitivo, url: location.pathname }); }

  // ── leitura do BCBP (IATA Resolução 792) ──
  function lerBcbp(v) {
    v = String(v || '');
    if (!/^M[1-9]/.test(v) || v.length < 58) return null;
    var nome = v.slice(2, 22).trim();
    var assento = v.slice(48, 52).replace(/^0+/, '');
    var seq = String(parseInt(v.slice(52, 57), 10) || '');
    return { nome: nome, pnr: v.slice(23, 30).trim(), origem: v.slice(30, 33), destino: v.slice(33, 36),
      voo: v.slice(36, 39).trim() + v.slice(39, 44).trim(), assento: assento, seq: seq ? ('000' + seq).slice(-3) : '' };
  }

  // ── passos ──
  async function passoMinhasViagens() {
    // espera sair do "Carregando informações"
    for (var i = 0; i < 40 && /Carregando informa/i.test(textoPagina()); i++) await dormir(500);
    var t = textoPagina();
    if (/Pr[oó]ximas viagens \(0\)/i.test(t)) return falha('a Azul não encontrou a reserva com esse localizador e origem', true);
    var alvoData = dataBR(job.data);
    var candidatos = botaoPorTexto(/Fazer check-?in/i);
    // o botão certo é o do card do trecho (origem, destino e dia)
    var certo = candidatos.filter(function (b) {
      var card = b;
      for (var n = 0; n < 8 && card; n++) {
        card = card.parentElement;
        var tc = txt(card);
        if (tc.indexOf(job.origem) >= 0 && tc.indexOf(job.destino) >= 0 && (!alvoData || tc.indexOf(alvoData) >= 0)) return true;
      }
      return false;
    })[0];
    if (!certo) {
      if (/Check-?in em \d/i.test(t)) return falha('o check-in deste trecho ainda não abriu no site da Azul', false);
      var cartao = botaoPorTexto(/cart[aã]o de embarque/i)[0];
      if (cartao) { clicar(cartao); return; }
      return falha('não achei o botão "Fazer check-in" do trecho ' + job.origem + '→' + job.destino, false);
    }
    clicar(certo);
  }

  async function passoSelecaoTrechos() {
    await dormir(1200);
    var alvoData = String(job.data || '').split('-').reverse().join('/');
    var caixas = [].slice.call(document.querySelectorAll('input[type="checkbox"]'));
    var minha = caixas.filter(function (c) {
      var rot = (c.getAttribute('aria-label') || '') + ' ' + txt(c.closest('label') || c.parentElement);
      return rot.indexOf(job.origem) >= 0 && rot.indexOf(job.destino) >= 0 && (!alvoData || rot.indexOf(alvoData) >= 0);
    })[0];
    if (!minha) return falha('não achei o trecho ' + job.origem + '→' + job.destino + ' na seleção de trechos', false);
    if (!minha.checked) clicar(minha.closest('label') || minha);
    await dormir(600);
    if (!minha.checked) clicar(minha);
    await dormir(600);
    var b = botaoPorTexto(/^Prosseguir/i)[0];
    if (!b) return falha('botão Prosseguir não apareceu na seleção de trechos', false);
    clicar(b);
  }

  async function passoPassageiros() {
    await dormir(1200);
    var todos = [].slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) {
      return /selecionar todos/i.test((c.getAttribute('aria-label') || '') + ' ' + txt(c.closest('label') || c.parentElement));
    })[0];
    if (todos && !todos.checked) clicar(todos.closest('label') || todos);
    await dormir(800);
    if (todos && !todos.checked) clicar(todos);
    await dormir(1200);
    // passageiros marcados × esperados
    var marcados = [].slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) {
      return c.checked && !/selecionar todos|pontuar|desejo/i.test((c.getAttribute('aria-label') || '') + ' ' + txt(c.closest('label') || c.parentElement));
    }).length;
    if (job.pax && marcados && marcados < job.pax) return falha('a Azul mostrou ' + marcados + ' passageiro(s), a reserva tem ' + job.pax, true);
    // campo obrigatório vazio (CPF, nascimento) = precisa de gente
    var vazios = [].slice.call(document.querySelectorAll('input')).filter(function (i) {
      return visivel(i) && !i.disabled && !i.readOnly && /text|tel|date/.test(i.type) && !i.value &&
        /cpf|nascimento|dd\/mm|documento|passaporte/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.name || ''));
    });
    if (vazios.length) return falha('faltam dados do passageiro no site (CPF, nascimento ou documento)', true);
    var b = botaoPorTexto(/^Prosseguir/i)[0];
    if (!b) return falha('botão Prosseguir não apareceu na tela de passageiros', false);
    clicar(b);
  }

  async function passoReview() {
    await dormir(1500);
    var t = textoPagina();
    var totais = (t.match(/R\$\s*[\d.,]+/g) || []);
    var cobra = totais.some(function (v) { return !/R\$\s*0,00/.test(v); });
    if (cobra) return falha('a Azul está cobrando algo no check-in (' + totais.filter(function (v) { return !/0,00/.test(v); })[0] + ') — não paguei nada', true);
    var b = botaoPorTexto(/Prosseguir/i)[0];
    if (!b) return falha('botão Prosseguir não apareceu no resumo', false);
    clicar(b);
  }

  async function passoContato() {
    await dormir(1500);
    var email = [].slice.call(document.querySelectorAll('input')).filter(function (i) { return /e-?mail/i.test((i.getAttribute('aria-label') || '') + (i.name || '') + (i.type || '')); })[0];
    if (email && !email.value) return falha('o site pediu e-mail de contato e ele está vazio', true);
    var termo = [].slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) {
      return /declaro que li/i.test((c.getAttribute('aria-label') || '') + ' ' + txt(c.closest('label') || c.parentElement));
    })[0];
    if (!termo) return falha('não achei a declaração dos termos de compromisso', false);
    // Autorizado pelo Davi em 21/11/2026: marcar sempre essa declaração.
    if (!termo.checked) clicar(termo.closest('label') || termo);
    await dormir(700);
    if (!termo.checked) clicar(termo);
    await dormir(700);
    var b = botaoPorTexto(/Finalizar check-?in/i)[0];
    if (!b) return falha('botão Finalizar check-in não ficou disponível', false);
    clicar(b);
  }

  async function passoCartao() {
    if (!('BarcodeDetector' in window)) return falha('este Chrome não lê QR code (BarcodeDetector)', true);
    for (var i = 0; i < 30 && !document.querySelector('main canvas'); i++) await dormir(500);
    await dormir(1500);
    var detector = new BarcodeDetector({ formats: ['qr_code', 'pdf417', 'aztec'] });
    var vistos = {}, cartoes = [];
    async function lerVisiveis() {
      var canvases = [].slice.call(document.querySelectorAll('main canvas, main img'));
      for (var k = 0; k < canvases.length; k++) {
        var c = canvases[k];
        if (c.tagName === 'IMG' && (c.naturalWidth < 80 || /logo|store|badge/i.test(c.src + c.alt))) continue;
        try {
          var lidos = await detector.detect(c);
          for (var j = 0; j < lidos.length; j++) {
            var v = lidos[j].rawValue;
            if (!v || vistos[v]) continue;
            var b = lerBcbp(v);
            if (!b) continue;
            vistos[v] = true;
            // dados do cartão em volta do QR
            var card = c, tc = '';
            for (var n = 0; n < 10 && card; n++) { card = card.parentElement; tc = card ? card.innerText : ''; if (/Assento/i.test(tc) && /Embarque/i.test(tc)) break; }
            var pega = function (re) { var m = re.exec(tc || ''); return m ? m[1].trim() : ''; };
            // nome: primeiro ancestral com "Cartão de NOME para" (o card do passageiro)
            var alto = card, ta = '';
            for (var n2 = 0; n2 < 8 && alto; n2++) { alto = alto.parentElement; ta = alto ? alto.innerText : ''; if (/Cart[aã]o de .+? para /i.test(ta)) break; }
            var mNome = /Cart[aã]o de (.+?) para /i.exec(ta || '');
            var nomeCompleto = mNome ? mNome[1].trim() : '';
            // grafia da emissão, quando bate com o nome do BCBP (SOBRENOME/NOME)
            var partes = b.nome.split('/');
            var daEmissao = (job.passageiros || []).filter(function (p) {
              var u = String(p).toUpperCase();
              return partes.every(function (x) { return !x || u.indexOf(x.split(' ')[0]) >= 0; });
            })[0];
            if (!nomeCompleto && daEmissao) nomeCompleto = daEmissao;
            tc = tc + '\n' + (ta || '');
            cartoes.push({
              bcbp: v,
              nome: nomeCompleto || b.nome,
              assento: pega(/Assento\s+([0-9]{1,2}[A-K])/i) || b.assento,
              secao: pega(/Se[cç][aã]o\s+([A-Z0-9]{1,3})\b/i),
              seq: b.seq,
              embarqueIni: pega(/In[ií]cio do Embarque\s+(\d{1,2}:\d{2})/i),
              embarqueFim: pega(/Fim do Embarque\s+(\d{1,2}:\d{2})/i),
              portao: pega(/Port[aã]o\s+([A-Z]?\d{1,3}[A-Z]?)\b/i),
              categoria: (function () { var m = /\b(SAFIRA|TOP[AÁ]ZIO|DIAMANTE|ESMERALDA)\b/i.exec(tc || ''); return m ? 'Azul Fidelidade · ' + m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; })()
            });
          }
        } catch (e) { /* imagem que não é QR */ }
      }
    }
    await lerVisiveis();
    // carrossel: avança até ler todos os passageiros esperados
    for (var vez = 0; vez < 8 && job.pax && cartoes.length < job.pax; vez++) {
      var prox = botaoPorTexto(/pr[oó]ximo|next|avan[cç]ar|seguinte/i)[0];
      if (!prox) break;
      clicar(prox); await dormir(1500); await lerVisiveis();
    }
    if (!cartoes.length) return falha('check-in pode ter sido feito, mas não consegui ler nenhum QR code do cartão', true);
    fim({ ok: true, cartoes: cartoes, esperados: job.pax || 0 });
  }

  var PASSOS = [
    [/\/minhas-viagens/i, passoMinhasViagens],
    [/\/azulwebcheckin\/selecao-trechos/i, passoSelecaoTrechos],
    [/\/azulwebcheckin\/passageiros/i, passoPassageiros],
    [/\/azulwebcheckin\/review/i, passoReview],
    [/\/azulwebcheckin\/contato/i, passoContato],
    [/\/azulwebcheckin\/cartao-embarque/i, passoCartao]
  ];

  async function laco() {
    var ultimo = '';
    // mantém o service worker da extensão acordado enquanto o robô trabalha
    var vivo = setInterval(function () { if (acabou) return clearInterval(vivo); try { chrome.runtime.sendMessage({ tipo: 'checkin-vivo' }); } catch (e) {} }, 15000);
    while (!acabou) {
      if (Date.now() - inicio > LIMITE_MS) return falha('demorou demais (4 min) na tela ' + location.pathname, false);
      var t = textoPagina();
      if (/Access Denied|captcha|n[aã]o sou um rob[oô]/i.test(document.title + ' ' + t.slice(0, 3000))) return falha('a Azul pediu verificação anti-robô', false);
      if (/\/pagamento/i.test(location.pathname)) return falha('a Azul levou para a tela de pagamento — não paguei nada', true);
      var caminho = location.pathname;
      var passo = PASSOS.filter(function (p) { return p[0].test(caminho); })[0];
      if (passo && caminho !== ultimo) {
        feitos[caminho] = (feitos[caminho] || 0) + 1;
        if (feitos[caminho] > 2) return falha('a tela ' + caminho + ' repetiu sem avançar', false);
        ultimo = caminho;
        try { await passo[1](); } catch (e) { return falha('erro na tela ' + caminho + ': ' + e.message, false); }
        await dormir(2500);
        // ainda na mesma tela depois de agir: tenta de novo uma vez
        if (!acabou && location.pathname === caminho) ultimo = '';
      }
      await dormir(1000);
    }
  }

  chrome.runtime.sendMessage({ tipo: 'checkin-meu-trabalho' }, function (r) {
    if (chrome.runtime.lastError || !r || !r.job) return;
    job = r.job;
    inicio = r.inicio || Date.now();
    laco();
  });
})();
