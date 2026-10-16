/**
 * bom-dia.js — Clube do Viajante · Concierge
 *
 * Mensagem de "bom dia" enviada ao grupo do cliente em cada dia do roteiro,
 * às 8h no fuso da cidade onde ele acorda, com previsão do tempo e o resumo
 * das atividades do dia.
 *
 * Arquivo COMPARTILHADO (mesma lógica nos dois lados, para a prévia do painel
 * ser exatamente o que o job envia):
 *   - lembrete-voo.js (Node 20, GitHub Actions) → require('./bom-dia.js')
 *   - index.html (navegador)                    → <script src="bom-dia.js">  → window.BomDia
 *
 * Fontes (sem chave, sem cadastro):
 *   - Open-Meteo Geocoding → cidade → lat/lng + fuso (IANA)
 *   - Open-Meteo Forecast  → máxima, mínima, chance de chuva e condição do dia
 *
 * Onde a pessoa está em cada dia (ordem):
 *   1. `dia.cidade` (preenchida à mão no painel; aceita "Lisboa → Milão")
 *   2. título do dia ("Lisboa → Milão": acorda em Lisboa, termina em Milão)
 *   3. a última cidade do dia anterior (dia sem cidade no título, ex. "Dia 5")
 */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.BomDia = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HORA_ENVIO  = 8;   // envia a partir das 08:00 locais…
  var HORA_LIMITE = 12;  // …e desiste ao meio-dia (job atrasado não manda "bom dia" à tarde)
  var GEO_URL  = 'https://geocoding-api.open-meteo.com/v1/search';
  var PREV_URL = 'https://api.open-meteo.com/v1/forecast';
  var LINK_ROTEIRO = 'https://roteiros.clubedoviajante.com.br/';

  // ── texto ────────────────────────────────────────────────────────────────
  function semAcento(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // Remove emoji/pictogramas do começo e espaços duplicados
  function limpar(s) {
    return String(s == null ? '' : s)
      .replace(/^[\s -㌀\uD83C-􏰀-\uDFFF️‍]+/, '')
      .replace(/\s+/g, ' ').trim();
  }

  var PREFIXOS = /^(chegada|partida|retorno|volta|regresso|saida|saída|bate[- ]volta|passeio|dia livre|dia|ida|viagem|translado|traslado)\s+(a|ao|à|as|às|em|no|na|de|do|da|para|pra|por)\s+/i;
  var GENERICO = /^(dia\s*\d+|dia livre|livre|descanso)$/i;

  // "Lisboa → Milão" → ['Lisboa', 'Milão']; "Chegada a Foz do Iguaçu" → ['Foz do Iguaçu']
  function cidadesDoTexto(txt) {
    var t = limpar(txt);
    if (!t) return [];
    var partes = t.split(/\s*(?:→|->|➜|⇒|⟶|>)\s*/);
    var out = [];
    partes.forEach(function (p) {
      var c = limpar(p).replace(PREFIXOS, '').replace(/[.:;]+$/, '').trim();
      if (c && !GENERICO.test(semAcento(c))) out.push(c);
    });
    return out;
  }

  // { manha, destino } do dia `idx`. manha = onde acorda (rege o fuso do envio).
  function cidadesDoDia(dias, idx) {
    var d = dias[idx] || {};
    var lista = cidadesDoTexto(d.cidade);
    if (!lista.length) lista = cidadesDoTexto(d.titulo);
    if (lista.length) return { manha: lista[0], destino: lista[lista.length - 1], manual: !!limpar(d.cidade) };
    for (var i = idx - 1; i >= 0; i--) {
      var ant = cidadesDoTexto((dias[i] || {}).cidade);
      if (!ant.length) ant = cidadesDoTexto((dias[i] || {}).titulo);
      if (ant.length) { var u = ant[ant.length - 1]; return { manha: u, destino: u, manual: false, herdada: true }; }
    }
    return { manha: '', destino: '', manual: false };
  }

  // Variações para a busca: "Lago de Como" → "Como"; "Tirano e St. Moritz" → "Tirano"
  function candidatosBusca(nome) {
    var base = limpar(nome);
    var out = [base];
    var semLago = base.replace(/^(lago|lake|lac|lagoa|ilha|isla|isola|costa|vale|valle|monte|praia)\s+(de|di|do|da|del|della|of)?\s*/i, '');
    out.push(semLago);
    base.split(/\s+e\s+|\s*,\s*|\s*&\s*|\s*\/\s*/i).forEach(function (p) { out.push(p); });
    out.push(base.replace(/\s*\(.*?\)\s*/g, ' ').trim());
    var vistos = {};
    return out.map(limpar).filter(function (x) {
      var k = semAcento(x).toLowerCase();
      if (!x || x.length < 2 || vistos[k]) return false;
      vistos[k] = 1; return true;
    });
  }

  // ── rede ─────────────────────────────────────────────────────────────────
  function obterJson(url, fetchFn) {
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('fetch indisponível'));
    return f(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url.split('?')[0]);
      return r.json();
    });
  }

  // Cidade → { nome, lat, lng, tz, pais }. Entre os resultados, fica o de maior
  // população (resolve "Florença", "Roma", "Paris" sem cair em homônimos).
  function geocodificar(nome, opts) {
    opts = opts || {};
    var cache = opts.cache || {};
    var chave = semAcento(nome).toLowerCase().trim();
    if (!chave) return Promise.resolve(null);
    if (cache[chave] !== undefined) return Promise.resolve(cache[chave]);
    var cands = candidatosBusca(nome);
    var i = 0;
    function proximo() {
      if (i >= cands.length) { cache[chave] = null; return Promise.resolve(null); }
      var q = cands[i++];
      var url = GEO_URL + '?name=' + encodeURIComponent(q) + '&count=5&language=pt&format=json';
      return obterJson(url, opts.fetch).then(function (d) {
        var rs = (d && d.results) || [];
        if (!rs.length) return proximo();
        rs.sort(function (a, b) { return (b.population || 0) - (a.population || 0); });
        var r = rs[0];
        var out = { nome: limpar(nome), busca: q, lat: r.latitude, lng: r.longitude, tz: r.timezone || '', pais: r.country || '' };
        cache[chave] = out;
        return out;
      });
    }
    return proximo();
  }

  // Previsão de UM dia no local. Open-Meteo cobre ~16 dias à frente; fora disso → null.
  function previsaoDia(lat, lng, dataISO, opts) {
    opts = opts || {};
    var url = PREV_URL + '?latitude=' + lat + '&longitude=' + lng +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&start_date=' + dataISO + '&end_date=' + dataISO;
    return obterJson(url, opts.fetch).then(function (d) {
      var x = d && d.daily;
      if (!x || !x.time || !x.time.length) return null;
      var max = x.temperature_2m_max && x.temperature_2m_max[0];
      var min = x.temperature_2m_min && x.temperature_2m_min[0];
      if (max == null || min == null) return null;
      return {
        max: Math.round(max), min: Math.round(min),
        chuva: x.precipitation_probability_max ? x.precipitation_probability_max[0] : null,
        codigo: x.weather_code ? x.weather_code[0] : null
      };
    }).catch(function () { return null; });
  }

  // Códigos WMO → [emoji, descrição]
  function condicao(cod) {
    var c = Number(cod);
    if (c === 0) return ['☀️', 'céu limpo'];
    if (c === 1) return ['🌤️', 'predomínio de sol'];
    if (c === 2) return ['⛅', 'parcialmente nublado'];
    if (c === 3) return ['☁️', 'nublado'];
    if (c === 45 || c === 48) return ['🌫️', 'neblina'];
    if (c >= 51 && c <= 57) return ['🌦️', 'garoa'];
    if (c === 61 || c === 80) return ['🌦️', 'chuva fraca'];
    if (c === 63 || c === 81) return ['🌧️', 'chuva'];
    if (c === 65 || c === 82) return ['🌧️', 'chuva forte'];
    if (c === 66 || c === 67) return ['🌧️', 'chuva congelante'];
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ['❄️', 'neve'];
    if (c >= 95) return ['⛈️', 'trovoadas'];
    return ['🌡️', ''];
  }

  // ── fuso ─────────────────────────────────────────────────────────────────
  // Data (YYYY-MM-DD) e hora locais agora no fuso `tz`.
  function agoraNoFuso(tz, agoraMs) {
    var dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    var p = {};
    dtf.formatToParts(new Date(agoraMs == null ? Date.now() : agoraMs)).forEach(function (x) { p[x.type] = x.value; });
    var h = Number(p.hour); if (h === 24) h = 0;
    return { data: p.year + '-' + p.month + '-' + p.day, hora: h, minuto: Number(p.minute) };
  }
  // Deslocamento (ms) do fuso em relação ao UTC no instante dado
  function offsetMs(tz, utcMs) {
    var a = agoraNoFuso(tz, utcMs);
    var p = a.data.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], a.hora, a.minuto) - Math.floor(utcMs / 60000) * 60000;
  }
  // Instante (ms UTC) de HH:00 local em `tz` no dia `dataISO` (duas passadas p/ horário de verão)
  function instanteLocal(dataISO, hora, tz) {
    var p = String(dataISO).split('-');
    var alvo = Date.UTC(+p[0], +p[1] - 1, +p[2], hora || 0, 0, 0);
    var ts = alvo - offsetMs(tz, alvo);
    return alvo - offsetMs(tz, ts);
  }
  // "08:00 em Roma" convertido para outro fuso (padrão Brasília) → { data, hhmm }
  function envioNoFuso(tz, dataISO, tzRef) {
    var a = agoraNoFuso(tzRef || 'America/Sao_Paulo', instanteLocal(dataISO, HORA_ENVIO, tz));
    return { data: a.data, hhmm: (a.hora < 10 ? '0' : '') + a.hora + ':' + (a.minuto < 10 ? '0' : '') + a.minuto };
  }
  function naJanela(tz, dataISO, agoraMs) {
    var a = agoraNoFuso(tz, agoraMs);
    return a.data === dataISO && a.hora >= HORA_ENVIO && a.hora < HORA_LIMITE;
  }

  // ── pessoas e grupos ─────────────────────────────────────────────────────
  // viagem.clientes é gravado como "A, B" (string única) pelo painel.
  function listaClientes(viagem) {
    if (!viagem) return [];
    var v = viagem.clientes != null ? viagem.clientes : viagem.cliente;
    var arr = Array.isArray(v) ? v : String(v || '').split(',');
    return arr.map(function (c) { return String(c).trim(); }).filter(Boolean);
  }

  function primeiroNome(n) {
    var p = limpar(n).split(' ')[0] || '';
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
  }

  // "Marisa", "Marisa e Ana", "Marisa, Ana e Bia"; 5+ pessoas → "pessoal"
  function saudacaoNomes(viagem) {
    var fonte = (viagem && typeof viagem.viajantes === 'string' && viagem.viajantes.trim())
      ? viagem.viajantes.split(/\s*,\s*|\s+e\s+|\s*&\s*/i) : listaClientes(viagem);
    var vistos = {};
    var nomes = fonte.map(primeiroNome).filter(function (n) {
      var k = semAcento(n).toLowerCase();
      if (!n || vistos[k]) return false; vistos[k] = 1; return true;
    });
    if (!nomes.length || nomes.length > 4) return { texto: 'pessoal', plural: true };
    if (nomes.length === 1) return { texto: nomes[0], plural: false };
    return { texto: nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1], plural: true };
  }

  // Grupos que recebem o bom dia. viagem.grupo (escolhido no cadastro da viagem)
  // vale para a viagem toda; sem ele, usa o grupo de cada cliente, sem repetir.
  // `clientes` = [{nome, grupo}]; `reservaGrupo` = mapa nome → grupo (fallback das reservas).
  function gruposDaViagem(viagem, clientes, reservaGrupo) {
    var g = String((viagem && viagem.grupo) || '').trim();
    if (g) return [{ grupo: g, origem: 'viagem' }];
    var out = [], vistos = {};
    listaClientes(viagem).forEach(function (nome) {
      var alvo = semAcento(nome).toLowerCase();
      var cli = (clientes || []).find(function (c) { return semAcento(c.nome).toLowerCase().trim() === alvo; });
      var grupo = (cli && cli.grupo) || (reservaGrupo && reservaGrupo[nome]) || '';
      if (grupo && !vistos[grupo]) { vistos[grupo] = 1; out.push({ grupo: grupo, origem: 'cliente', cliente: nome }); }
    });
    return out;
  }

  // ── mensagem ─────────────────────────────────────────────────────────────
  // Segue o padrão dos modelos do concierge (modelos.json): título em negrito
  // com um emoji, blocos separados por linha em branco, cada bloco com um
  // cabeçalho "emoji + *Título*" e linhas "Rótulo: *valor*", fecho em negrito.
  var DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  function dataExtenso(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    return DIAS_SEMANA[d.getUTCDay()] + ', ' + p[2] + '/' + p[1];
  }

  function frasaChuva(pct) {
    if (pct == null) return '';
    if (pct < 20) return 'sem chuva prevista';
    if (pct < 60) return pct + '% de chance de chuva';
    return 'chuva provável (' + pct + '%)';
  }

  function linhaTempo(cidade, prev) {
    if (!prev) return '';
    var desc = condicao(prev.codigo)[1];
    var extra = [desc, frasaChuva(prev.chuva)].filter(Boolean).join(', ');
    return cidade + ': *' + prev.min + '° a ' + prev.max + '°*' + (extra ? ' · ' + extra : '');
  }

  function linhaAtividade(a) {
    var nome = limpar(a && a.nome).replace(/\s*[☀-➿\uD83C-􏰀-\uDFFF️]+\s*/g, ' ').trim();
    if (!nome) return '';
    if (nome.length > 90) nome = nome.slice(0, 87).trim() + '…';
    var h = limpar(a.horario);
    return (h ? '*' + h + '* · ' : '') + nome;
  }

  // ctx = { viagem, dias, idx, previsoes: [{cidade, prev}] }
  function montarMensagem(ctx) {
    var viagem = ctx.viagem || {};
    var dias = ctx.dias || [];
    var d = dias[ctx.idx] || {};
    var quem = saudacaoNomes(viagem);
    var pl = quem.plural;
    var ultimo = ctx.idx === dias.length - 1;
    var L = [];

    L.push('☀️ *Bom dia, ' + quem.texto + '!*');
    L.push('');
    var titulo = limpar(d.titulo);
    var abertura = 'Hoje é o *dia ' + (ctx.idx + 1) + '* da viagem' + (d.data ? ' (' + dataExtenso(d.data) + ')' : '');
    if (titulo) abertura += /→|->/.test(titulo) ? ' e o trajeto é *' + titulo + '*.' : ' e o destino é *' + titulo + '*.';
    else abertura += '.';
    L.push(abertura);

    var prevs = (ctx.previsoes || []).filter(function (p) { return p.prev; });
    if (prevs.length) {
      L.push('');
      L.push('🌤️ *Previsão do tempo*');
      prevs.forEach(function (p) { L.push(linhaTempo(p.cidade, p.prev)); });
      if (prevs.some(function (p) { return p.prev.chuva != null && p.prev.chuva >= 60; })) {
        L.push('Vale ' + (pl ? 'levarem' : 'levar') + ' um guarda-chuva.');
      }
    }

    L.push('');
    var ativs = (d.atividades || []).map(linhaAtividade).filter(Boolean);
    if (ativs.length) {
      L.push('📍 *Programação do dia*');
      ativs.slice(0, 8).forEach(function (t) { L.push(t); });
      if (ativs.length > 8) L.push('E mais ' + (ativs.length - 8) + ' no roteiro.');
    } else {
      L.push('Hoje não há atividades programadas. ' + (pl ? 'Aproveitem' : 'Aproveite') + ' para conhecer a cidade no ' + (pl ? 'ritmo de vocês' : 'seu ritmo') + '.');
    }

    if (viagem.slugRoteiro) {
      L.push('');
      L.push('O roteiro completo está aqui:');
      L.push(LINK_ROTEIRO + viagem.slugRoteiro + '/');
    }

    L.push('');
    L.push(ultimo ? '*Boa volta para casa e conte conosco!* ✈️' : '*' + (pl ? 'Aproveitem' : 'Aproveite') + ' o dia e conte conosco!* ✈️');
    return L.join('\n');
  }

  // Resolve cidades, fuso e previsão de um dia. Usado pelo job e pela prévia.
  // opts = { fetch, cache }
  function prepararDia(viagem, idx, opts) {
    opts = opts || {};
    var dias = (viagem && viagem.roteiroDias) || [];
    var d = dias[idx] || {};
    var cid = cidadesDoDia(dias, idx);
    var res = { idx: idx, data: d.data || '', cidades: cid, geoManha: null, geoDestino: null, tz: '', previsoes: [], erro: '' };
    if (!cid.manha) { res.erro = 'sem cidade no dia'; return Promise.resolve(res); }
    return geocodificar(cid.manha, opts).then(function (gm) {
      res.geoManha = gm;
      if (gm) res.tz = gm.tz;
      var mesma = semAcento(cid.destino).toLowerCase() === semAcento(cid.manha).toLowerCase();
      return mesma ? gm : geocodificar(cid.destino, opts);
    }).then(function (gd) {
      res.geoDestino = gd;
      if (!res.geoManha && !gd) { res.erro = 'cidade não encontrada: ' + cid.manha; return res; }
      if (!res.tz && gd) res.tz = gd.tz;
      if (!d.data) return res;
      var alvos = [];
      // Rótulo = nome efetivamente buscado ("Tirano e St. Moritz" → previsão de "Tirano")
      if (res.geoManha) alvos.push({ cidade: res.geoManha.busca || cid.manha, g: res.geoManha });
      if (gd && gd !== res.geoManha) alvos.push({ cidade: gd.busca || cid.destino, g: gd });
      return Promise.all(alvos.map(function (a) {
        return previsaoDia(a.g.lat, a.g.lng, d.data, opts).then(function (p) { return { cidade: a.cidade, prev: p }; });
      })).then(function (ps) { res.previsoes = ps; return res; });
    }).catch(function (e) { res.erro = e.message; return res; });
  }

  return {
    HORA_ENVIO: HORA_ENVIO, HORA_LIMITE: HORA_LIMITE,
    cidadesDoTexto: cidadesDoTexto, cidadesDoDia: cidadesDoDia, candidatosBusca: candidatosBusca,
    geocodificar: geocodificar, previsaoDia: previsaoDia, condicao: condicao,
    agoraNoFuso: agoraNoFuso, naJanela: naJanela, envioNoFuso: envioNoFuso,
    listaClientes: listaClientes, saudacaoNomes: saudacaoNomes, gruposDaViagem: gruposDaViagem,
    montarMensagem: montarMensagem, prepararDia: prepararDia
  };
});
