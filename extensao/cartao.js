// Gera o PDF do cartão de embarque (layout do pdf-reserva.js) para o robô de
// check-in. Aberta em segundo plano pelo checkin-robo.js; devolve o PDF em
// base64 e a aba é fechada pelo robô.
(function () {
  'use strict';
  var st = document.getElementById('st');
  var vivo = setInterval(function () { try { chrome.runtime.sendMessage({ tipo: 'cartao-vivo' }); } catch (e) {} }, 15000);
  function fim(r) { clearInterval(vivo); chrome.runtime.sendMessage({ tipo: 'cartao-pronto', resultado: r }); }

  function qrDataUrl(texto) {
    var q = qrcode(0, 'L'); q.addData(texto); q.make();
    return q.createDataURL(8, 2);
  }
  function logo() {
    return fetch(chrome.runtime.getURL('icones/logo-concierge.png')).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) { var f = new FileReader(); f.onload = function () { ok(f.result); }; f.readAsDataURL(b); });
    }).catch(function () { return ''; });
  }
  // Nome das cidades pelo iata.js publicado no site do concierge (só leitura
  // de texto; nenhum código de fora é executado).
  function aeroportos() {
    return fetch('https://concierge.clubedoviajante.com.br/iata.js', { cache: 'force-cache' }).then(function (r) { return r.text(); }).then(function (t) {
      var mapa = {}, re = /"([A-Z]{3})\|([^"]+)"/g, m;
      while ((m = re.exec(t))) mapa[m[1]] = m[2];
      return mapa;
    }).catch(function () { return {}; });
  }
  function hoje() { var d = new Date(Date.now() - 3 * 3600e3); return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear(); }

  chrome.runtime.sendMessage({ tipo: 'cartao-meu-trabalho' }, function (t) {
    if (!t || !t.item) { st.textContent = 'Nada para gerar.'; return; }
    var item = t.item, cartoes = t.cartoes || [];
    Promise.all([logo(), aeroportos()]).then(function (res) {
      var mapa = res[1];
      var c0 = cartoes[0] || {};
      var d = Object.assign({}, item.pdf || {}, {
        pnr: item.pnr, embarqueIni: c0.embarqueIni, embarqueFim: c0.embarqueFim, portao: c0.portao,
        passageiros: cartoes.map(function (c) {
          return { nome: c.nome, categoria: c.categoria, assento: c.assento, secao: c.secao, seq: c.seq, qr: qrDataUrl(c.bcbp) };
        })
      });
      var ctx = { logo: res[0], hoje: hoje(), nomeAeroporto: function (cod) { return mapa[cod] || ''; } };
      var m = PdfReserva.montarCartaoEmbarque(d, ctx);
      m.html2pdfSrc = chrome.runtime.getURL('vendor/html2pdf.bundle.min.js');
      return PdfReserva.gerarPDFDe(m);
    }).then(function (arq) {
      st.textContent = 'Pronto.';
      fim({ ok: true, base64: arq.base64, nome: arq.nome, tamanho: arq.tamanho });
    }).catch(function (e) {
      st.textContent = 'Erro: ' + (e && e.message || e);
      fim({ ok: false, erro: String(e && e.message || e) });
    });
  });
})();
