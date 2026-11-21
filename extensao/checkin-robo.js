// Robô de check-in automático (Azul) — parte que roda no background da extensão.
//
// A cada 10 min (chrome.alarms) pergunta ao proxy se há check-in na fila
// (GET /concierge/checkin/fila, chave X-CDV-Robo colada em opcoes.html).
// Para cada item: abre o link da Azul numa aba em segundo plano, o
// checkin-azul.js faz os cliques e devolve os QR codes; a aba cartao.html
// gera o PDF no layout do Concierge (pdf-reserva.js); o robô manda o modelo
// "Check-in realizado" + PDF no grupo do cliente pelo baileys-server, avisa o
// grupo de gestão e grava o resultado (POST /concierge/checkin/resultado, que
// também conclui a demanda). Falhou: tenta de novo na rodada seguinte (até 3
// vezes, contadas no proxy); na última, avisa o grupo de gestão para fazer à mão.
//
// Roda no Chrome do Davi porque a Azul barra acesso vindo de servidor (403).
// Nada de dado de cliente fica gravado no navegador: o trabalho em andamento
// vive em chrome.storage.session (some ao fechar o Chrome) e o registro das
// rodadas guarda só ids, horários e motivos.
var ROBO_PROXY = 'https://cdv-proxy-production.up.railway.app';
var ROBO_BAILEYS = 'https://baileys-server-production-ebfe.up.railway.app';
var ROBO_ALARME = 'cdv-checkin';
var ROBO_INTERVALO_MIN = 10;
var ROBO_TIMEOUT_MS = 6 * 60 * 1000;

function roboAgendar() {
  chrome.alarms.get(ROBO_ALARME, function (a) {
    if (!a) chrome.alarms.create(ROBO_ALARME, { delayInMinutes: 1, periodInMinutes: ROBO_INTERVALO_MIN });
  });
}
chrome.runtime.onInstalled.addListener(roboAgendar);
chrome.runtime.onStartup.addListener(roboAgendar);
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === ROBO_ALARME) roboRodada('alarme'); });

function roboCfg() {
  return chrome.storage.local.get(['roboChave', 'roboAtivo', 'roboLog']).then(function (s) {
    return { chave: s.roboChave || '', ativo: s.roboAtivo !== false, log: Array.isArray(s.roboLog) ? s.roboLog : [] };
  });
}
function roboLogar(linha) {
  return chrome.storage.local.get('roboLog').then(function (s) {
    var log = Array.isArray(s.roboLog) ? s.roboLog : [];
    log.unshift({ em: new Date().toISOString(), txt: String(linha).slice(0, 300) });
    return chrome.storage.local.set({ roboLog: log.slice(0, 60) });
  });
}

function roboApi(caminho, chave, corpo) {
  return fetch(ROBO_PROXY + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: Object.assign({ 'X-CDV-Robo': chave }, corpo ? { 'Content-Type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: 'no-store'
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok || d.ok === false) throw new Error((d && d.erro) || ('HTTP ' + r.status));
      return d;
    });
  });
}
function roboWhats(rota, corpo) {
  return fetch(ROBO_BAILEYS + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    .then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || !d.ok) throw new Error((d && d.erro) || ('WhatsApp HTTP ' + r.status));
        return d;
      });
    });
}

// Horário de São Paulo (−03:00 fixo)
function roboHoraSP() { return new Date(Date.now() - 3 * 3600e3).getUTCHours(); }

var _roboRodando = false;
async function roboRodada(origem) {
  if (_roboRodando) return { ok: false, erro: 'já há uma rodada em andamento' };
  var cfg = await roboCfg();
  if (!cfg.chave) return { ok: false, erro: 'falta a chave do robô (opções da extensão)' };
  if (!cfg.ativo && origem !== 'manual') return { ok: false, erro: 'robô desligado' };
  _roboRodando = true;
  var feitos = 0;
  try {
    var fila = (await roboApi('/concierge/checkin/fila', cfg.chave)).data || [];
    await chrome.storage.local.set({ roboUltimaRodada: new Date().toISOString(), roboFila: fila.length });
    var hora = roboHoraSP();
    for (var i = 0; i < fila.length; i++) {
      var item = fila[i];
      if (item.cia !== 'azul') continue;
      var falta = Date.parse(item.partidaEm) - Date.now();
      // de madrugada só faz o que não pode esperar (partida em até 8 h)
      if ((hora < 6 || hora >= 23) && falta > 8 * 3600e3 && origem !== 'manual') continue;
      // depois de uma falha, espera 25 min antes de tentar de novo
      if (item.ultimaTentativaEm && Date.now() - Date.parse(item.ultimaTentativaEm) < 25 * 60e3 && origem !== 'manual') continue;
      await roboProcessar(item, cfg.chave);
      feitos++;
    }
    return { ok: true, fila: fila.length, processados: feitos };
  } catch (e) {
    await roboLogar('rodada falhou: ' + e.message);
    return { ok: false, erro: e.message };
  } finally {
    _roboRodando = false;
  }
}

function roboAbrirAba(url) {
  return chrome.tabs.create({ url: url, active: false });
}
function roboFecharAba(id) { return chrome.tabs.remove(id).catch(function () {}); }

// Espera a mensagem final de uma aba (checkin-azul.js ou cartao.html)
var _roboEspera = {};
function roboEsperarAba(tabId, ms) {
  return new Promise(function (ok) {
    var t = setTimeout(function () { delete _roboEspera[tabId]; ok({ ok: false, erro: 'a página não respondeu a tempo', definitivo: false }); }, ms);
    _roboEspera[tabId] = function (r) { clearTimeout(t); delete _roboEspera[tabId]; ok(r); };
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
  var tabId = sender && sender.tab && sender.tab.id;
  if (msg && msg.tipo === 'checkin-meu-trabalho') {
    chrome.storage.session.get('job:' + tabId).then(function (s) {
      var j = s['job:' + tabId];
      responder(j ? { job: j.item, inicio: j.inicio } : {});
    });
    return true;
  }
  if (msg && msg.tipo === 'cartao-meu-trabalho') {
    chrome.storage.session.get('cartao:' + tabId).then(function (s) { responder(s['cartao:' + tabId] || {}); });
    return true;
  }
  if (msg && (msg.tipo === 'checkin-resultado' || msg.tipo === 'cartao-pronto')) {
    if (_roboEspera[tabId]) _roboEspera[tabId](msg.resultado);
    return false;
  }
  if (msg && msg.tipo === 'robo-rodar-agora') {
    roboRodada('manual').then(responder);
    return true;
  }
  return false;
});

function roboResumo(item) {
  return item.cliente + ' · ' + item.origem + '→' + item.destino + ' · ' + String(item.data || '').split('-').reverse().join('/');
}

async function roboProcessar(item, chave) {
  await roboLogar('começando ' + item.id);
  // 1. check-in no site da Azul
  var aba = await roboAbrirAba(item.link);
  await chrome.storage.session.set({ ['job:' + aba.id]: { item: item, inicio: Date.now() } });
  var r = await roboEsperarAba(aba.id, ROBO_TIMEOUT_MS);
  await chrome.storage.session.remove('job:' + aba.id);
  await roboFecharAba(aba.id);

  if (!r || !r.ok) return roboFalhou(item, chave, (r && r.erro) || 'falha sem motivo', r && r.definitivo);

  // 2. PDF no layout do Concierge
  var pdf;
  try {
    var abaPdf = await roboAbrirAba(chrome.runtime.getURL('cartao.html'));
    await chrome.storage.session.set({ ['cartao:' + abaPdf.id]: { item: item, cartoes: r.cartoes } });
    pdf = await roboEsperarAba(abaPdf.id, 90 * 1000);
    await chrome.storage.session.remove('cartao:' + abaPdf.id);
    await roboFecharAba(abaPdf.id);
    if (!pdf || !pdf.ok) throw new Error((pdf && pdf.erro) || 'não gerou o PDF');
  } catch (e) {
    // check-in já está feito na Azul: avisa a equipe para mandar o cartão à mão
    return roboFalhou(item, chave, 'check-in FEITO na Azul, mas o PDF falhou (' + e.message + ') — baixe o cartão no site e envie ao cliente', true, true);
  }

  // 3. WhatsApp: modelo + PDF no grupo do cliente (sem grupo: vai para a gestão)
  var destino = item.grupoCliente || item.grupoGestao;
  var avisoGrupo = item.grupoCliente ? '' : ' (cliente sem grupo cadastrado: PDF enviado aqui)';
  try {
    if (item.mensagem && item.grupoCliente) await roboWhats('/enviar', { grupo: destino, mensagem: item.mensagem, conta: item.conta || '' });
    await roboWhats('/enviar-arquivo', { grupo: destino, legenda: '🎫 Cartão de embarque', base64: pdf.base64, mimetype: 'application/pdf', nomeArquivo: pdf.nome, conta: item.conta || '' });
  } catch (e) {
    return roboFalhou(item, chave, 'check-in FEITO na Azul, mas o envio ao grupo do cliente falhou (' + e.message + ')', true, true);
  }

  // 4. registro + aviso na gestão
  var n = r.cartoes.length;
  var parcial = r.esperados && n < r.esperados ? ' ⚠️ só ' + n + ' de ' + r.esperados + ' cartões lidos — conferir os outros no site' : '';
  try { await roboApi('/concierge/checkin/resultado', chave, { id: item.id, ok: true, cartoes: n }); }
  catch (e) { await roboLogar('feito, mas não gravou o resultado: ' + e.message); }
  if (item.grupoGestao) {
    var linhas = ['✅ *Check-in feito (automático)*', '', '*Cliente:* ' + item.cliente, '*Trecho:* ' + item.origem + ' → ' + item.destino + ' · ' + String(item.data).split('-').reverse().join('/') + (item.hora ? ' às ' + item.hora : ''),
      '*Localizador:* ' + item.pnr, '*Cartões:* ' + n + ' enviados ao grupo do cliente' + avisoGrupo];
    r.cartoes.forEach(function (c) { linhas.push('• ' + c.nome + (c.assento ? ' — assento ' + c.assento : '')); });
    if (parcial) linhas.push('', parcial);
    await roboWhats('/enviar', { grupo: item.grupoGestao, mensagem: linhas.join('\n'), conta: item.conta || '' }).catch(function () {});
  }
  await roboLogar('feito ' + item.id + ' (' + n + ' cartões)');
}

async function roboFalhou(item, chave, motivo, definitivo, jaFeito) {
  var st = {};
  try { st = await roboApi('/concierge/checkin/resultado', chave, { id: item.id, ok: false, erro: motivo, definitivo: !!definitivo }); }
  catch (e) { await roboLogar('não gravou a falha: ' + e.message); }
  await roboLogar('falhou ' + item.id + ': ' + motivo);
  // Só incomoda a equipe quando o robô desistiu (definitivo ou última tentativa)
  if (st.status === 'falhou' && item.grupoGestao) {
    var msg = [(jaFeito ? '⚠️ *Check-in automático: falta enviar o cartão*' : '⚠️ *Check-in automático não deu certo — fazer manualmente*'), '',
      '*Cliente:* ' + roboResumo(item), '*Localizador:* ' + item.pnr, '*Motivo:* ' + motivo, '', '*Link Azul:* ' + item.link].join('\n');
    await roboWhats('/enviar', { grupo: item.grupoGestao, mensagem: msg, conta: item.conta || '' }).catch(function () {});
  }
}
