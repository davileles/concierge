/* pdf-reserva.js — comprovante em PDF de uma reserva do concierge (Travel Concierge).
 *
 * Só monta o HTML do documento; quem transforma em PDF é o painel (html2pdf).
 * Toda seção é opcional: aparece só quando há dado na reserva ou nas opções
 * que o concierge preencheu na hora de gerar (op). Nada de CPF, documento
 * ou cartão no PDF.
 *
 *   PdfReserva.opcoesPadrao(reserva)        → op inicial (parte do que já existe)
 *   PdfReserva.montarHTML(reserva, op, ctx) → string HTML completa (A4)
 *   ctx: { logo: dataURI, nomeAeroporto: fn(IATA) → "Cidade – Aeroporto (País)" }
 */
(function (raiz) {
  'use strict';

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  // Nome curto do aeroporto, quando o nome oficial é longo ou pouco usado no Brasil
  var AERO_CURTO = {
    GRU: 'Guarulhos', CGH: 'Congonhas', VCP: 'Viracopos', CNF: 'Confins', PLU: 'Pampulha', GIG: 'Galeão',
    SDU: 'Santos Dumont', BSB: 'Brasília', SSA: 'Salvador', REC: 'Recife', FOR: 'Fortaleza', POA: 'Salgado Filho',
    CWB: 'Afonso Pena', FLN: 'Hercílio Luz', NVT: 'Navegantes', BEL: 'Val-de-Cans', MAO: 'Eduardo Gomes',
    ORY: 'Orly', CDG: 'Charles de Gaulle', LHR: 'Heathrow', LGW: 'Gatwick', JFK: 'JFK', EWR: 'Newark',
    MIA: 'Miami', MCO: 'Orlando', LIS: 'Humberto Delgado', OPO: 'Francisco Sá Carneiro', MAD: 'Barajas',
    BCN: 'El Prat', FCO: 'Fiumicino', MXP: 'Malpensa', AMS: 'Schiphol', FRA: 'Frankfurt', MUC: 'Munique',
    ZRH: 'Zurique', DXB: 'Dubai', DOH: 'Hamad', IST: 'Istambul', SCL: 'Santiago', EZE: 'Ezeiza', AEP: 'Aeroparque',
    LIM: 'Jorge Chávez', CPT: 'Internacional', JNB: 'O. R. Tambo', ICN: 'Incheon', BOG: 'El Dorado', PTY: 'Tocumen', CUN: 'Cancún', MEX: 'Cidade do México', CUR: 'Hato'
  };
  var PAIS_PT = { Brasil: 'Brasil', Brazil: 'Brasil' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function txt(v) { return String(v == null ? '' : v).trim(); }

  // "26772,1" | "R$ 2.526,67" | "85000" | "42.500" → número
  function num(v) {
    var s = txt(v).replace(/R\$|\s/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return parseFloat(s);
  }
  function fmtInt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtBRL(n) {
    var p = n.toFixed(2).split('.');
    return 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
  }
  function milhas(v) { var n = num(v); return isNaN(n) || !n ? '' : fmtInt(n); }
  function reais(v) { var n = num(v); return isNaN(n) || !n ? '' : fmtBRL(n); }

  function data(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function dataLonga(iso) { var d = data(iso); return d ? DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() : ''; }
  function dataCurta(iso) { var d = data(iso); return d ? d.getDate() + ' de ' + MESES[d.getMonth()] : ''; }
  function difDias(a, b) { var x = data(a), y = data(b); return x && y ? Math.round((y - x) / 864e5) : 0; }

  function titulo(s) {
    var minus = /^(da|de|do|das|dos|e)$/i;
    return txt(s).toLowerCase().split(/\s+/).map(function (w, i) {
      return i && minus.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  // "BARROS / LAURA" → "Laura Barros"; "MR. MATOS JOSE" → "Matos Jose"; "CHILD X" → "X"
  function nomePax(s) {
    var n = txt(s).replace(/^(MRS?|MS|MISS|MSTR|CHILD|CHD|INF|INFANT)\.?\s+/i, '').replace(/\s+(MRS?|MS|MISS|MSTR|CHD|INF)\.?$/i, '');
    n = n.replace(/\s+(senhora|senhor|sra|sr)\.?(?=\s)/ig, '');
    var b = n.split('/');
    if (b.length === 2) n = b[1].trim() + ' ' + b[0].trim();
    return titulo(n);
  }

  function aero(cod, ctx) {
    cod = txt(cod).toUpperCase();
    var lab = '';
    try { lab = (ctx && ctx.nomeAeroporto && ctx.nomeAeroporto(cod)) || ''; } catch (e) { lab = ''; }
    var m = /^(.*?)\s+–\s+(.*?)(?:\s+\(([^)]*)\))?\s*$/.exec(lab);
    var cidade = m ? m[1].replace(/\s*\(.*\)\s*$/, '') : '';
    var nome = AERO_CURTO[cod] || (m ? m[2] : '');
    if (nome && cidade && nome.toLowerCase() === cidade.toLowerCase()) nome = '';
    if (nome.length > 26) nome = '';
    var pais = m ? (PAIS_PT[m[3]] || m[3] || '') : '';
    return { cod: cod, cidade: cidade || cod, nome: nome, pais: pais };
  }
  function ehNacional(r, ctx) {
    var cods = [r.origem, r.destino, r.origemVolta, r.destinoVolta].filter(Boolean);
    return cods.every(function (c) { return aero(c, ctx).pais === 'Brasil'; });
  }

  function listaVoos(s) { return txt(s).split(/\s*[,;/]\s*|\s+e\s+/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean); }
  function listaPnr(s) { return txt(s).split(/\s*[,;/]\s*/).filter(Boolean); }

  function trechosDaReserva(r) {
    var t = [{
      sentido: 'ida', data: r.dataIda, dataCheg: r.dataChegadaIda || r.dataIda,
      origem: r.origem, destino: r.destino, hp: r.horaPartida, hc: r.horaChegada,
      cia: r.ciaIda, voos: listaVoos(r.nvooIda), conexao: r.conexao
    }];
    if (txt(r.dataVolta)) t.push({
      sentido: 'volta', data: r.dataVolta, dataCheg: r.dataChegadaVolta || r.dataVolta,
      origem: r.origemVolta || r.destino, destino: r.destinoVolta || r.origem,
      hp: r.horaPartidaVolta, hc: r.horaChegadaVolta, cia: r.ciaVolta || r.ciaIda,
      voos: listaVoos(r.nvooVolta), conexao: r.conexaoVolta
    });
    return t;
  }

  function opcoesPadrao(r) {
    r = r || {};
    var salvo = r.pdf || {};
    var pax = Array.isArray(r.passageiros) && r.passageiros.length
      ? r.passageiros.map(function (p) { return nomePax(typeof p === 'string' ? p : (p && (p.nome || p.name)) || ''); }).filter(Boolean)
      : [];
    var base = {
      passageiros: pax,               // nomes; vazio → usa o cliente + nº de pax
      assentoIda: '', assentoVolta: '',
      bilhetes: '',                    // números dos bilhetes, um por linha
      tarifa: '',                      // nome da tarifa (ex. Light, Plus, Business Flex)
      taxas: '',                       // R$ das taxas, quando conhecidas
      bagagem: { ativo: false, pessoal: '', mao: '', despachada: '' },
      regras: '',                      // uma regra por linha
      dicas: true,                     // bloco "Antes de embarcar"
      mostrarPagamento: true,
      mostrarEconomia: !!txt(r.economiaGerada),
      obs: '',                         // recado livre ao cliente
      // hotel / passeio
      quarto: '', regime: '', horaCheckin: '', horaCheckout: '', endereco: ''
    };
    Object.keys(salvo).forEach(function (k) { if (salvo[k] !== undefined) base[k] = salvo[k]; });
    if (salvo.bagagem) base.bagagem = Object.assign({ ativo: false, pessoal: '', mao: '', despachada: '' }, salvo.bagagem);
    return base;
  }

  var ICONE_AVIAO = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" transform="rotate(90 128 128)" d="M235.58 128.84 160 91.06V48a32 32 0 0 0-64 0v43.06l-75.58 37.78A8 8 0 0 0 16 136v32a8 8 0 0 0 9.57 7.84L96 161.76v18.93L82.34 194.34A8 8 0 0 0 80 200v32a8 8 0 0 0 11 7.43l37-14.81 37 14.81a8 8 0 0 0 11-7.43v-32a8 8 0 0 0-2.34-5.66L160 180.69v-18.93l70.43 14.08A8 8 0 0 0 240 168v-32a8 8 0 0 0-4.42-7.16Z"/></svg>';
  var ICONES_MALA = {
    pessoal: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216 56h-40v-8a24 24 0 0 0-24-24h-48a24 24 0 0 0-24 24v8H40a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V72a16 16 0 0 0-16-16ZM96 48a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96Zm120 152H40V72h176v128Z"/></svg>',
    mao: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M184 64h-24V40a24 24 0 0 0-24-24h-16a24 24 0 0 0-24 24v24H72a24 24 0 0 0-24 24v104a24 24 0 0 0 24 24 16 16 0 0 0 32 0h48a16 16 0 0 0 32 0 24 24 0 0 0 24-24V88a24 24 0 0 0-24-24Zm-72-24a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v24h-32Zm80 152a8 8 0 0 1-8 8H72a8 8 0 0 1-8-8V88a8 8 0 0 1 8-8h112a8 8 0 0 1 8 8Z"/></svg>',
    despachada: '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M200 40H56a16 16 0 0 0-16 16v152a16 16 0 0 0 16 16 16 16 0 0 0 32 0h80a16 16 0 0 0 32 0 16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 168H56V56h144Zm-96-128v96a8 8 0 0 1-16 0V80a8 8 0 0 1 16 0Zm64 0v96a8 8 0 0 1-16 0V80a8 8 0 0 1 16 0Z"/></svg>'
  };

  var CSS = [
    '.pdf-res,.pdf-res *{box-sizing:border-box;margin:0;padding:0}',
    '.pdf-res{--ink:#1c2130;--ink2:#4a5163;--muted:#8a8f9c;--cream:#F4EFE7;--paper:#FBF9F5;--line:#E4DCCD;--gold:#C8A45C;--gold2:#9A7B36;--night:#12151f}',
    '.pdf-res{width:210mm;background:var(--paper);font-family:Manrope,Arial,sans-serif;color:var(--ink);font-size:9.5pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.pdf-res .serif{font-family:"Instrument Serif",Georgia,serif;font-weight:400}',
    '.pdf-res .capa{background:var(--night);color:#f4efe7;padding:11mm 15mm 9mm;position:relative;overflow:hidden}',
    '.pdf-res .capa:after{content:"";position:absolute;right:-40mm;top:-40mm;width:120mm;height:120mm;border-radius:50%;border:1px solid rgba(200,164,92,.22)}',
    '.pdf-res .capa:before{content:"";position:absolute;right:-20mm;top:-20mm;width:80mm;height:80mm;border-radius:50%;border:1px solid rgba(200,164,92,.14)}',
    '.pdf-res .marca{display:flex;align-items:center;gap:10px}',
    '.pdf-res .marca img{width:34px;height:34px;border-radius:7px}',
    '.pdf-res .marca span{font-size:8pt;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);font-weight:600}',
    '.pdf-res h1{font-size:29pt;line-height:1.04;margin-top:6mm;letter-spacing:-.01em;max-width:120mm}',
    '.pdf-res h1 em{color:var(--gold)}',
    '.pdf-res .sub{margin-top:3mm;color:rgba(244,239,231,.72);font-weight:300;font-size:10pt;max-width:132mm}',
    '.pdf-res .pnr{position:absolute;right:15mm;bottom:9mm;text-align:right;z-index:1}',
    '.pdf-res .pnr small{display:block;font-size:7pt;letter-spacing:.22em;text-transform:uppercase;color:rgba(244,239,231,.55)}',
    '.pdf-res .pnr b{display:block;font-size:20pt;letter-spacing:.12em;font-weight:600;color:var(--gold);line-height:1.15}',
    '.pdf-res .pnr.varios b{font-size:15pt}',
    '.pdf-res .faixa{height:2.2mm;background:linear-gradient(90deg,var(--gold2),var(--gold),#e6cf9a,var(--gold))}',
    '.pdf-res main{padding:6mm 15mm 0}',
    '.pdf-res .rotulo{font-size:7pt;letter-spacing:.22em;text-transform:uppercase;color:var(--gold2);font-weight:700;margin-bottom:2.4mm;display:flex;align-items:center;gap:8px}',
    '.pdf-res .rotulo:after{content:"";flex:1;height:1px;background:var(--line)}',
    '.pdf-res section{margin-bottom:4.5mm;break-inside:avoid;page-break-inside:avoid}',
    '.pdf-res .trecho{background:#fff;border:1px solid var(--line);border-radius:4mm;overflow:hidden;break-inside:avoid;page-break-inside:avoid}',
    '.pdf-res .trecho+.trecho{margin-top:3.5mm}',
    '.pdf-res .trecho-top{display:flex;justify-content:space-between;align-items:center;gap:4mm;padding:2.6mm 6mm;background:var(--cream);border-bottom:1px solid var(--line);font-size:8.5pt}',
    '.pdf-res .trecho-top b{font-weight:700}',
    '.pdf-res .cia{display:flex;align-items:center;gap:8px}',
    '.pdf-res .cia i{min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--ink);color:#fff;font-style:normal;font-size:6.5pt;font-weight:700;display:grid;place-items:center;letter-spacing:.04em}',
    '.pdf-res .rota{display:grid;grid-template-columns:1fr 1.3fr 1fr;align-items:center;padding:4.5mm 6mm 4mm}',
    '.pdf-res .ponto .iata{font-size:32pt;line-height:1;font-family:"Instrument Serif",Georgia,serif}',
    '.pdf-res .ponto .hora{font-size:15pt;font-weight:600;margin-top:1.5mm}',
    '.pdf-res .ponto .hora sup{font-size:7.5pt;color:var(--gold2);font-weight:700;margin-left:2px}',
    '.pdf-res .ponto .local{color:var(--ink2);font-size:8.5pt;margin-top:.5mm}',
    '.pdf-res .ponto.dir{text-align:right}',
    '.pdf-res .ponto .rot{font-size:6.8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:1mm}',
    '.pdf-res .card{word-break:break-word}',
    '.pdf-res .linha{position:relative;height:18mm}',
    '.pdf-res .linha .arco{position:absolute;left:4mm;right:4mm;top:9mm;border-top:1.5px dashed var(--gold)}',
    '.pdf-res .linha .arco:before,.pdf-res .linha .arco:after{content:"";position:absolute;top:-3.5px;width:6px;height:6px;border-radius:50%;background:var(--gold)}',
    '.pdf-res .linha .arco:before{left:-3px}.pdf-res .linha .arco:after{right:-3px}',
    '.pdf-res .linha .esc{position:absolute;top:9mm;transform:translate(-50%,-50%);background:#fff;border:1.2px solid var(--gold);border-radius:6px;padding:0 4px;font-size:7pt;font-weight:700;color:var(--gold2);letter-spacing:.06em}',
    '.pdf-res .linha svg{position:absolute;left:50%;top:9mm;transform:translate(-50%,-50%);width:22px;height:22px;background:#fff;padding:2px}',
    '.pdf-res .linha .dur{position:absolute;left:0;right:0;top:12.5mm;text-align:center;font-size:8pt;color:var(--muted)}',
    '.pdf-res .detalhes{display:flex;border-top:1px solid var(--line)}',
    '.pdf-res.compacto .capa{padding:9mm 15mm 7mm}',
    '.pdf-res.compacto h1{font-size:26pt;margin-top:4mm}',
    '.pdf-res.compacto main{padding-top:5mm}',
    '.pdf-res.compacto footer{padding:3mm 0 2.5mm}',
    '.pdf-res.compacto .card{padding:3.2mm 5.5mm}',
    '.pdf-res.compacto section{margin-bottom:3.5mm}',
    '.pdf-res.compacto ul.regras li{padding:.5mm 0 .5mm 6mm}',
    '.pdf-res.compacto ul.regras li:before{top:2.2mm}',
    '.pdf-res.compacto .trecho+.trecho{margin-top:2.5mm}',
    '.pdf-res.compacto .rota{padding:3mm 6mm 2.5mm}',
    '.pdf-res.compacto .ponto .iata{font-size:26pt}',
    '.pdf-res.compacto .ponto .hora{font-size:13pt;margin-top:1mm}',
    '.pdf-res.compacto .linha{height:15mm}',
    '.pdf-res.compacto .linha .arco,.pdf-res.compacto .linha .esc,.pdf-res.compacto .linha svg{top:7.5mm}',
    '.pdf-res.compacto .linha .dur{top:10.5mm}',
    '.pdf-res.compacto .detalhes div{padding:2.2mm 4.5mm}',
    '.pdf-res.compacto .trecho-top{padding:2.2mm 6mm}',
    '.pdf-res .detalhes div{flex:1 1 0;padding:3mm 4.5mm;border-right:1px solid var(--line);min-width:0}',
    '.pdf-res .detalhes div:last-child{border-right:0}',
    '.pdf-res .detalhes small{display:block;font-size:6.8pt;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}',
    '.pdf-res .detalhes b{font-size:9pt;font-weight:600}',
    '.pdf-res .duas{display:grid;grid-template-columns:1fr 1fr;gap:6mm}',
    '.pdf-res .card{background:#fff;border:1px solid var(--line);border-radius:4mm;padding:4mm 5.5mm}',
    '.pdf-res .pax{display:flex;align-items:center;gap:3.5mm;padding:1.3mm 0}',
    '.pdf-res .pax+.pax{border-top:1px dotted var(--line)}',
    '.pdf-res .pax .ini{flex:none;width:9mm;height:9mm;border-radius:50%;background:var(--cream);border:1px solid var(--gold);display:grid;place-items:center;font-family:"Instrument Serif",Georgia,serif;font-size:13pt;color:var(--gold2)}',
    '.pdf-res .pax b{font-size:10pt;font-weight:600;display:block;line-height:1.25}',
    '.pdf-res .pax span{color:var(--ink2);font-size:8pt}',
    '.pdf-res .kv{display:flex;justify-content:space-between;gap:4mm;padding:1.2mm 0;border-bottom:1px dotted var(--line)}',
    '.pdf-res .kv:last-child{border-bottom:0}',
    '.pdf-res .kv span{color:var(--ink2)}',
    '.pdf-res .kv b{font-weight:600;text-align:right}',
    '.pdf-res .total{margin-top:3mm;padding-top:3mm;border-top:1px solid var(--ink);display:flex;justify-content:space-between;align-items:baseline;gap:4mm}',
    '.pdf-res .total .serif{font-size:17pt;text-align:right;line-height:1.15}',
    '.pdf-res .eco{margin-top:3mm;background:var(--night);color:var(--cream);border-radius:3mm;padding:3mm 4mm;font-size:8.5pt;display:flex;justify-content:space-between}',
    '.pdf-res .eco b{color:var(--gold);font-weight:600}',
    '.pdf-res .malas{display:flex;gap:4mm}',
    '.pdf-res .mala{flex:1 1 0;background:#fff;border:1px solid var(--line);border-radius:4mm;padding:3mm 5mm;display:grid;grid-template-columns:24px 1fr;column-gap:3mm;align-items:center}',
    '.pdf-res .mala svg{width:20px;height:20px;color:var(--gold2);grid-row:span 2}',
    '.pdf-res .mala.nao{opacity:.55}',
    '.pdf-res .mala b{display:block;font-size:9.5pt;font-weight:600}',
    '.pdf-res .mala span{font-size:8pt;color:var(--ink2)}',
    '.pdf-res ul.regras{list-style:none}',
    '.pdf-res ul.regras li{position:relative;padding:.8mm 0 .8mm 6mm;color:var(--ink2)}',
    '.pdf-res ul.regras li:before{content:"";position:absolute;left:0;top:2.6mm;width:2.2mm;height:2.2mm;border-radius:50%;border:1.2px solid var(--gold)}',
    '.pdf-res ul.regras li b{color:var(--ink);font-weight:600}',
    '.pdf-res .recado{background:var(--cream);border-left:2px solid var(--gold);border-radius:0 3mm 3mm 0;padding:3.5mm 5mm;color:var(--ink);white-space:pre-line}',
    '.pdf-res footer{margin:1mm 15mm 0;padding:3.5mm 0 6mm;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end;gap:6mm;font-size:7.5pt;color:var(--muted);break-inside:avoid;page-break-inside:avoid}',
    '.pdf-res footer .serif{font-size:13pt;color:var(--ink)}'
  ].join('\n');

  function htmlTrecho(t, r, op, ctx) {
    var o = aero(t.origem, ctx), d = aero(t.destino, ctx);
    var cx = txt(t.conexao).toUpperCase();
    var escalas = /^[A-Z]{3}$/.test(cx) && cx !== o.cod && cx !== d.cod ? [cx] : [];
    if (!escalas.length) escalas = (txt(t.conexao).match(/\b[A-Z]{3}\b/g) || []).filter(function (c) { return c !== o.cod && c !== d.cod; });
    var nVoos = t.voos.length;
    var dur;
    if (escalas.length) dur = (escalas.length === 1 ? '1 conexão' : escalas.length + ' conexões') + ' · ' + escalas.map(function (c) { return aero(c, ctx).cidade; }).join(', ');
    else if (nVoos > 1) dur = nVoos + ' voos';
    else dur = 'voo direto';
    var meio;
    if (escalas.length) {
      meio = escalas.map(function (c, i) {
        return '<span class="esc" style="left:' + Math.round(100 * (i + 1) / (escalas.length + 1)) + '%">' + esc(c) + '</span>';
      }).join('');
    } else meio = ICONE_AVIAO;
    var mais = difDias(t.data, t.dataCheg);
    var local = function (a) { return esc(a.cidade) + (a.nome ? ' · ' + esc(a.nome) : ''); };

    var det = [];
    var cab = txt(r.classe);
    if (cab) det.push(['Cabine', cab]);
    if (txt(op.tarifa)) det.push(['Tarifa', op.tarifa]);
    if (nVoos) det.push([nVoos > 1 ? 'Voos' : 'Voo', t.voos.join(' · ')]);
    var assento = t.sentido === 'volta' ? op.assentoVolta : op.assentoIda;
    if (txt(assento)) det.push(['Assento', assento]);
    if (txt(t.cia)) det.push(['Companhia', t.cia]);

    var sigla = txt(t.cia).replace(/[^A-Za-zÀ-ú ]/g, '').split(/\s+/).filter(Boolean);
    sigla = (sigla.length > 1 ? sigla.map(function (w) { return w.charAt(0); }).join('') : (sigla[0] || '✈').slice(0, 2)).toUpperCase().slice(0, 3);

    return '<div class="trecho">' +
      '<div class="trecho-top"><div class="cia"><i>' + esc(sigla) + '</i><span><b>' + (t.sentido === 'volta' ? 'Volta' : (r.dataVolta ? 'Ida' : 'Voo')) + '</b>' +
      (txt(t.cia) ? ' · ' + esc(t.cia) : '') + '</span></div>' +
      '<div>' + (t.sentido === 'volta' ? '🛬' : '🛫') + ' <b>' + esc(dataLonga(t.data)) + '</b></div></div>' +
      '<div class="rota">' +
      '<div class="ponto"><div class="iata">' + esc(o.cod) + '</div><div class="hora">' + esc(t.hp || '—') + '</div><div class="local">' + local(o) + '</div></div>' +
      '<div class="linha"><div class="arco"></div>' + meio + '<div class="dur">' + esc(dur) + '</div></div>' +
      '<div class="ponto dir"><div class="iata">' + esc(d.cod) + '</div><div class="hora">' + esc(t.hc || '—') + (mais > 0 ? '<sup>+' + mais + '</sup>' : '') + '</div><div class="local">' + local(d) + '</div></div>' +
      '</div>' +
      (det.length ? '<div class="detalhes">' + det.map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>' : '') +
      '</div>';
  }

  function htmlPassageiros(r, op) {
    var nomes = (op.passageiros || []).map(txt).filter(Boolean);
    var bilhetes = txt(op.bilhetes).split(/\n+/).map(txt).filter(Boolean);
    var nPax = parseInt(r.paxBalcao || r.pax, 10) || 0;
    if (!nomes.length) {
      var cli = titulo(r.cliente);
      var extra = nPax > 1 ? ' + ' + (nPax - 1) + (nPax - 1 > 1 ? ' acompanhantes' : ' acompanhante') : '';
      return '<div class="card"><div class="pax"><div class="ini">' + esc(cli.charAt(0) || '·') + '</div><div><b>' + esc(cli + extra) + '</b><span>' +
        (nPax ? nPax + (nPax > 1 ? ' passageiros' : ' passageiro') : 'Titular da reserva') + '</span></div></div></div>';
    }
    return '<div class="card">' + nomes.map(function (n, i) {
      return '<div class="pax"><div class="ini">' + esc(n.charAt(0)) + '</div><div><b>' + esc(n) + '</b>' +
        (bilhetes[i] ? '<span>Bilhete ' + esc(bilhetes[i]) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function htmlPagamento(r, op) {
    var linhas = [], total = '';
    var nPax = parseInt(r.paxBalcao || r.pax, 10) || 0;
    var taxas = reais(op.taxas);
    var tipo = txt(r.tipoEmissao);
    if (tipo === 'milhas' || (!tipo && txt(r.milhasTotal))) {
      var prog = txt(r.programa);
      var mt = milhas(r.milhasTotal) || milhas(r.milhas);
      if (prog) linhas.push(['Programa', prog]);
      if (milhas(r.milhas) && nPax > 1) linhas.push(['Milhas por passageiro', milhas(r.milhas)]);
      if (mt) linhas.push([nPax > 1 ? 'Milhas no total' : 'Milhas utilizadas', mt]);
      if (taxas) linhas.push(['Taxas de embarque', taxas]);
      if (mt) total = mt + ' milhas' + (taxas ? ' + ' + taxas : '');
    } else if (tipo === 'balcao') {
      var tot = reais(r.valorTotalBalcao);
      if (txt(r.programaBalcao || r.programa)) linhas.push(['Emitido via', r.programaBalcao || r.programa]);
      if (txt(r.valorPaxBalcao) && nPax > 1) linhas.push(['Por passageiro', reais(r.valorPaxBalcao)]);
      if (taxas) linhas.push(['Taxas de embarque', taxas]);
      total = tot;
    } else if (tipo === 'dinheiro' || tipo === 'dinheiro_acumulo') {
      var v = reais(r.valorDinheiro || r.valorAcumulo);
      if (taxas) linhas.push(['Taxas de embarque', taxas]);
      if (tipo === 'dinheiro_acumulo' && milhas(r.milhasAcumulo)) linhas.push(['Acúmulo', milhas(r.milhasAcumulo) + ' ' + txt(r.programaAcumuloVoo || 'pontos')]);
      total = v;
    }
    if (!linhas.length && !total) return '';
    var eco = op.mostrarEconomia && txt(r.economiaGerada)
      ? '<div class="eco"><span>Economia com a estratégia</span><b>' + esc(/R\$/.test(r.economiaGerada) ? r.economiaGerada : 'R$ ' + r.economiaGerada) + '</b></div>' : '';
    return '<div class="card">' + linhas.map(function (x) { return '<div class="kv"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
      (total ? '<div class="total"' + (linhas.length ? '' : ' style="margin-top:0;padding-top:0;border-top:0"') + '><span>Total</span><span class="serif">' + esc(total) + '</span></div>' : '') +
      eco + '</div>';
  }

  function htmlDicas(r, ctx) {
    var nac = ehNacional(r, ctx);
    var cia = txt(r.ciaIda) || 'companhia aérea';
    var o = aero(r.origem, ctx);
    var itens = [
      'Faça o <b>check-in on-line</b> assim que abrir, no app ou site da ' + esc(cia) + '.',
      'Confira o <b>horário de apresentação</b> no cartão de embarque' + (o.nome ? ' e chegue com folga a ' + esc(o.nome) : '') + '.'
    ];
    if (nac) itens.push('Leve um <b>documento oficial com foto</b>, com o mesmo nome da reserva.');
    else {
      itens.push('Leve o <b>passaporte</b> válido por pelo menos 6 meses' + (txt(r.dataVolta) ? ' após a volta' : '') + '.');
      itens.push('Confira <b>vistos e autorizações</b> exigidos no destino e nas conexões.');
    }
    return '<ul class="regras">' + itens.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>';
  }

  function htmlBagagem(op) {
    var b = op.bagagem || {};
    if (!b.ativo) return '';
    var itens = [['pessoal', 'Item pessoal'], ['mao', 'Mala de mão'], ['despachada', 'Despachada']].filter(function (x) { return txt(b[x[0]]); });
    if (!itens.length) return '';
    return '<section><div class="rotulo">Bagagem incluída</div><div class="malas">' + itens.map(function (x) {
      var v = txt(b[x[0]]);
      var nao = /^(n[ãa]o|nenhum|sem)\b/i.test(v);
      return '<div class="mala' + (nao ? ' nao' : '') + '">' + ICONES_MALA[x[0]] + '<b>' + esc(x[1]) + '</b><span>' + esc(v) + '</span></div>';
    }).join('') + '</div></section>';
  }

  function htmlRegras(op, rotulo) {
    var linhas = txt(op.regras).split(/\n+/).map(txt).filter(Boolean);
    if (!linhas.length) return '';
    return '<section><div class="rotulo">' + esc(rotulo || 'Regras da tarifa') + '</div><ul class="regras">' + linhas.map(function (l) {
      var m = /^([^:]{2,28}):\s*(.+)$/.exec(l);
      return '<li>' + (m ? '<b>' + esc(m[1]) + ':</b> ' + esc(m[2]) : esc(l)) + '</li>';
    }).join('') + '</ul></section>';
  }

  function montarVoo(r, op, ctx) {
    var trechos = trechosDaReserva(r);
    var dest = aero(r.destino, ctx);
    var idaVolta = trechos.length > 1;
    var nPax = (op.passageiros || []).filter(Boolean).length || parseInt(r.paxBalcao || r.pax, 10) || 0;
    var pnrs = listaPnr(r.pnr);
    // "Boa viagem, Fulano" só quando o cliente está entre os passageiros (ou não há nomes)
    var primeiro = titulo(r.cliente).split(' ')[0] || '';
    var nomesPax = (op.passageiros || []).map(function (n) { return txt(n).toLowerCase(); }).filter(Boolean);
    if (primeiro && nomesPax.length && !nomesPax.some(function (n) { return n.split(' ')[0] === primeiro.toLowerCase(); })) primeiro = '';

    var sub = 'Confirmação de reserva aérea · ' + (idaVolta ? 'ida e volta' : 'só ida') +
      (idaVolta ? ' · ' + dataCurta(r.dataIda) + ' a ' + dataCurta(r.dataVolta) : '') +
      (nPax > 1 ? ' · ' + nPax + ' passageiros' : '');

    var pag = op.mostrarPagamento ? htmlPagamento(r, op) : '';
    var pax = htmlPassageiros(r, op);
    var dicas = op.dicas ? htmlDicas(r, ctx) : '';

    var meio;
    if (pag) {
      // "Antes de embarcar" vai embaixo da coluna mais curta, para caber numa página
      var altPax = Math.max(1, (pax.match(/class="pax"/g) || []).length) * 1.15;
      var altPag = (pag.match(/class="kv"/g) || []).length + (/class="total"/.test(pag) ? 1.6 : 0) + (/class="eco"/.test(pag) ? 1.3 : 0);
      var blocoDicas = dicas ? '<div class="rotulo" style="margin-top:4mm">Antes de embarcar</div>' + dicas : '';
      var esq = altPax <= altPag;
      meio = '<section class="duas"><div><div class="rotulo">' + (nPax > 1 ? 'Passageiros' : 'Passageiro') + '</div>' + pax + (esq ? blocoDicas : '') +
        '</div><div><div class="rotulo">Pagamento</div>' + pag + (esq ? '' : blocoDicas) + '</div></section>';
    } else {
      meio = '<section class="duas"><div><div class="rotulo">' + (nPax > 1 ? 'Passageiros' : 'Passageiro') + '</div>' + pax + '</div>' +
        (dicas ? '<div><div class="rotulo">Antes de embarcar</div>' + dicas + '</div>' : '<div></div>') + '</section>';
    }

    return {
      compacto: idaVolta,
      corpo: capa(ctx, 'Sua viagem para', dest.cidade, sub, pnrs, pnrs.length > 1 ? 'Localizadores' : 'Localizador') +
        '<main>' +
        '<section><div class="rotulo">' + (idaVolta ? 'Voos' : 'Voo') + '</div>' + trechos.map(function (t) { return htmlTrecho(t, r, op, ctx); }).join('') + '</section>' +
        meio + htmlBagagem(op) + htmlRegras(op, 'Regras da tarifa') + htmlRecado(op) +
        '</main>' + rodape(ctx, primeiro),
      arquivo: pnrs[0] || r.id || ''
    };
  }

  function capa(ctx, chamada, destaque, sub, codigos, rotuloCod) {
    return '<div class="capa">' +
      '<div class="marca">' + (ctx.logo ? '<img src="' + esc(ctx.logo) + '" alt="">' : '') + '<span>Travel Concierge</span></div>' +
      '<h1 class="serif">' + esc(chamada) + (destaque ? '<br><em>' + esc(destaque) + '</em>' : '') + '</h1>' +
      '<div class="sub">' + esc(sub) + '</div>' +
      (codigos.length ? '<div class="pnr' + (codigos.length > 1 || codigos[0].length > 9 ? ' varios' : '') + '"><small>' + esc(rotuloCod) + '</small>' +
        codigos.map(function (p) { return '<b>' + esc(p) + '</b>'; }).join('') + '</div>' : '') +
      '</div><div class="faixa"></div>';
  }
  function rodape(ctx, primeiro) {
    return '<footer><div><div class="serif">Boa viagem' + (primeiro ? ', ' + esc(primeiro) : '') + '.</div>Qualquer imprevisto, fale com a gente no seu grupo do concierge.</div>' +
      '<div style="text-align:right">Travel Concierge · Clube do Viajante<br>Documento informativo · ' + esc(ctx.hoje || '') + '</div></footer>';
  }
  function htmlRecado(op) {
    return txt(op.obs) ? '<section><div class="rotulo">Recado do seu concierge</div><div class="recado">' + esc(op.obs) + '</div></section>' : '';
  }
  function primeiroNome(r, op) {
    var primeiro = titulo(r.cliente).split(' ')[0] || '';
    var nomes = (op.passageiros || []).map(function (n) { return txt(n).toLowerCase(); }).filter(Boolean);
    if (primeiro && nomes.length && !nomes.some(function (n) { return n.split(' ')[0] === primeiro.toLowerCase(); })) primeiro = '';
    return primeiro;
  }
  function lista(itens) { return '<ul class="regras">' + itens.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'; }

  // ── Hotel, transporte, locação, passeio e seguro ──
  function cidadeDe(v, ctx) {
    v = txt(v);
    if (/^[A-Z]{3}$/.test(v)) return aero(v, ctx).cidade;
    return v.replace(/\s+-\s+[A-Z]{2}$/, '');
  }
  // Valor livre ("41.80 EUR", "$49.500"): número puro vira R$, o resto vai como foi digitado
  function valorLivre(v) {
    var t = txt(v);
    if (!t) return '';
    if (/^(R\$\s*)?[\d.,]+$/.test(t)) return reais(t);
    return t;
  }
  function dataBloco(iso, hora, rotulo, dir) {
    var d = data(iso);
    return '<div class="ponto' + (dir ? ' dir' : '') + '"><div class="rot">' + esc(rotulo) + '</div>' +
      '<div class="iata">' + (d ? d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) : '—') + '</div>' +
      '<div class="hora">' + esc(hora || (d ? DIAS[d.getDay()] : '')) + '</div>' +
      (hora && d ? '<div class="local">' + esc(DIAS[d.getDay()]) + '</div>' : '') + '</div>';
  }
  function cartaoReserva(topoEsq, topoDir, esq, meio, dir, det) {
    return '<div class="trecho">' +
      '<div class="trecho-top"><div class="cia"><span>' + topoEsq + '</span></div><div>' + topoDir + '</div></div>' +
      '<div class="rota">' + esq + '<div class="linha"><div class="arco"></div>' + (meio.icone || '') + '<div class="dur">' + esc(meio.texto || '') + '</div></div>' + dir + '</div>' +
      (det.length ? '<div class="detalhes">' + det.map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>' : '') +
      '</div>';
  }
  function localBloco(cod, hora, nome, dir) {
    return '<div class="ponto' + (dir ? ' dir' : '') + '"><div class="hora" style="margin-top:0;font-size:13pt">' + esc(nome || '—') + '</div>' +
      (hora ? '<div class="iata" style="font-size:24pt;margin-top:1mm">' + esc(hora) + '</div>' : '') + '</div>';
  }
  function pagamentoGenerico(r, op) {
    var linhas = [], total = '';
    var tipo = txt(r.tipoEmissao);
    if (tipo === 'milhas') {
      var m = milhas(r.valorMilhas);
      if (txt(r.programaMilhas)) linhas.push(['Programa', r.programaMilhas]);
      if (m) total = m + ' ' + (/livelo|esfera|pontos|accor|all/i.test(r.programaMilhas || '') ? 'pontos' : 'milhas');
    } else if (tipo === 'dinheiro_acumulo') {
      total = valorLivre(r.valorAcumulo);
      if (milhas(r.milhasAcumulo)) linhas.push(['Pontos acumulados', milhas(r.milhasAcumulo) + (txt(r.programaAcumulo) ? ' ' + r.programaAcumulo : '')]);
      if (txt(r.parceiroAcumulo) && !/^outro$/i.test(r.parceiroAcumulo)) linhas.push(['Comprado via', r.parceiroAcumulo]);
    } else if (tipo === 'dinheiro') {
      total = valorLivre(r.valorDinheiro || r.valor);
    } else {
      total = valorLivre(r.valor || r.valorDinheiro);
    }
    if (!linhas.length && !total) return '';
    var eco = op.mostrarEconomia && txt(r.economiaGerada)
      ? '<div class="eco"><span>Economia com a estratégia</span><b>' + esc(/R\$/.test(r.economiaGerada) ? r.economiaGerada : 'R$ ' + r.economiaGerada) + '</b></div>' : '';
    return '<div class="card">' + linhas.map(function (x) { return '<div class="kv"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
      (total ? '<div class="total"' + (linhas.length ? '' : ' style="margin-top:0;padding-top:0;border-top:0"') + '><span>Total</span><span class="serif">' + esc(total) + '</span></div>' : '') +
      eco + '</div>';
  }
  function pessoas(r, op, n, singular, plural) {
    var nomes = (op.passageiros || []).map(txt).filter(Boolean);
    if (nomes.length) return '<div class="card">' + nomes.map(function (x) {
      return '<div class="pax"><div class="ini">' + esc(x.charAt(0)) + '</div><div><b>' + esc(x) + '</b></div></div>';
    }).join('') + '</div>';
    var cli = titulo(r.cliente);
    var extra = n > 1 ? ' + ' + (n - 1) + (n - 1 > 1 ? ' acompanhantes' : ' acompanhante') : '';
    return '<div class="card"><div class="pax"><div class="ini">' + esc(cli.charAt(0) || '·') + '</div><div><b>' + esc(cli + extra) + '</b><span>' +
      (n ? n + ' ' + (n > 1 ? plural : singular) : 'Titular da reserva') + '</span></div></div></div>';
  }
  function duasColunas(rotPessoas, blocoPessoas, pag, rotDicas, dicas) {
    var bd = dicas ? '<div class="rotulo" style="margin-top:4mm">' + esc(rotDicas) + '</div>' + dicas : '';
    if (pag) {
      var altA = Math.max(1, (blocoPessoas.match(/class="pax"/g) || []).length) * 1.15;
      var altB = (pag.match(/class="kv"/g) || []).length + (/class="total"/.test(pag) ? 1.6 : 0) + (/class="eco"/.test(pag) ? 1.3 : 0);
      var esq = altA <= altB;
      return '<section class="duas"><div><div class="rotulo">' + esc(rotPessoas) + '</div>' + blocoPessoas + (esq ? bd : '') +
        '</div><div><div class="rotulo">Pagamento</div>' + pag + (esq ? '' : bd) + '</div></section>';
    }
    return '<section class="duas"><div><div class="rotulo">' + esc(rotPessoas) + '</div>' + blocoPessoas + '</div>' +
      (dicas ? '<div><div class="rotulo">' + esc(rotDicas) + '</div>' + dicas + '</div>' : '<div></div>') + '</section>';
  }

  var ICONE_CAMA = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" d="M208 72H24V48a8 8 0 0 0-16 0v160a8 8 0 0 0 16 0v-32h208v32a8 8 0 0 0 16 0v-96a40 40 0 0 0-40-40Zm-96 88H24V88h88Zm16 0V88h80a24 24 0 0 1 24 24v48Z"/></svg>';
  var ICONE_TREM = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" d="M184 24H72a32 32 0 0 0-32 32v120a32 32 0 0 0 32 32h4l-14.4 19.2a8 8 0 1 0 12.8 9.6L96 208h64l21.6 28.8a8 8 0 1 0 12.8-9.6L180 208h4a32 32 0 0 0 32-32V56a32 32 0 0 0-32-32ZM56 120V80h64v40Zm80-40h64v40h-64ZM72 40h112a16 16 0 0 1 16 16v8H56v-8a16 16 0 0 1 16-16Zm112 152H72a16 16 0 0 1-16-16v-40h144v40a16 16 0 0 1-16 16Zm-84-28a12 12 0 1 1-12-12 12 12 0 0 1 12 12Zm80 0a12 12 0 1 1-12-12 12 12 0 0 1 12 12Z"/></svg>';
  var ICONE_CARRO = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" d="M240 112h-10.8l-27.78-62.5A16 16 0 0 0 186.8 40H69.2a16 16 0 0 0-14.62 9.5L26.8 112H16a8 8 0 0 0 0 16h8v80a16 16 0 0 0 16 16h24a16 16 0 0 0 16-16v-16h96v16a16 16 0 0 0 16 16h24a16 16 0 0 0 16-16v-80h8a8 8 0 0 0 0-16ZM69.2 56h117.6l24.89 56H44.31ZM64 208H40v-16h24Zm128 0v-16h24v16Zm24-32H40v-48h176ZM56 152a8 8 0 0 1 8-8h16a8 8 0 0 1 0 16H64a8 8 0 0 1-8-8Zm112 0a8 8 0 0 1 8-8h16a8 8 0 0 1 0 16h-16a8 8 0 0 1-8-8Z"/></svg>';
  var ICONE_ESCUDO = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" d="M208 40H48a16 16 0 0 0-16 16v56c0 52.72 25.52 84.67 46.93 102.19 23.06 18.86 46 25.26 47 25.53a8 8 0 0 0 4.2 0c1-.27 23.91-6.67 47-25.53C198.48 196.67 224 164.72 224 112V56a16 16 0 0 0-16-16Zm0 72c0 37.07-13.66 67.16-40.6 89.42a129.3 129.3 0 0 1-39.4 22.2 128.25 128.25 0 0 1-38.92-21.81C61.82 179.51 48 149.3 48 112V56h160ZM82.34 141.66a8 8 0 0 1 11.32-11.32L112 148.69l50.34-50.35a8 8 0 0 1 11.32 11.32l-56 56a8 8 0 0 1-11.32 0Z"/></svg>';
  var ICONE_PASSEIO = '<svg viewBox="0 0 256 256"><path fill="#9A7B36" d="M128 64a40 40 0 1 0 40 40 40 40 0 0 0-40-40Zm0 64a24 24 0 1 1 24-24 24 24 0 0 1-24 24Zm0-112a88.1 88.1 0 0 0-88 88c0 31.4 14.51 64.68 42 96.25a254.19 254.19 0 0 0 41.45 38.3 8 8 0 0 0 9.18 0 254.19 254.19 0 0 0 41.37-38.3c27.45-31.57 42-64.85 42-96.25a88.1 88.1 0 0 0-88-88Zm0 206c-16.53-13-72-60.75-72-118a72 72 0 0 1 144 0c0 57.23-55.47 105-72 118Z"/></svg>';

  var NOME_SUB = { trem: 'Trem', onibus: 'Ônibus', ferry: 'Ferry', transfer: 'Transfer', locacao: 'Locação de carro' };

  function montarOutro(r, op, ctx) {
    var tipo = txt(r.tipo), sub = txt(r.subtipo) || 'transfer';
    if (tipo === 'transfer') { tipo = 'carro'; sub = 'transfer'; }
    var conf = listaPnr(r.conf);
    var primeiro = primeiroNome(r, op);
    var n = parseInt(r.hospedes || r.pax, 10) || 0;
    var pag = op.mostrarPagamento ? pagamentoGenerico(r, op) : '';
    var dicas = [], det = [], cartao = '', chamada = '', destaque = '', subtit = '', rotPessoas = 'Passageiros', blocoExtra = '';
    var rotRegras = 'Política de cancelamento', rotCod = 'Confirmação';

    if (tipo === 'hotel') {
      var cid = cidadeDe(r.destino, ctx);
      var noites = parseInt(r.noites, 10) || difDias(r.checkin, r.checkout);
      chamada = 'Sua hospedagem em'; destaque = cid;
      subtit = 'Confirmação de hotel · ' + (noites ? noites + (noites > 1 ? ' noites' : ' noite') + ' · ' : '') + dataCurta(r.checkin) + ' a ' + dataCurta(r.checkout) + (n > 1 ? ' · ' + n + ' hóspedes' : '');
      if (txt(op.quarto)) det.push(['Quarto', op.quarto]);
      if (txt(op.regime)) det.push(['Regime', op.regime]);
      if (noites) det.push(['Noites', String(noites)]);
      if (n) det.push(['Hóspedes', String(n)]);
      cartao = cartaoReserva('<b>' + esc(r.hotelNome || 'Hotel') + '</b>', esc(cid),
        dataBloco(r.checkin, op.horaCheckin, 'Check-in'), { icone: ICONE_CAMA.replace('<svg', '<svg style="width:22px;height:22px"'), texto: noites ? noites + (noites > 1 ? ' noites' : ' noite') : '' },
        dataBloco(r.checkout, op.horaCheckout, 'Check-out', true), det);
      if (txt(op.endereco)) blocoExtra = '<section><div class="rotulo">Endereço</div><div class="card">' + esc(op.endereco) + '</div></section>';
      rotPessoas = n > 1 ? 'Hóspedes' : 'Hóspede';
      dicas = ['Na recepção, informe o <b>código de confirmação</b> e apresente um <b>documento com foto</b>' + (/^[A-Z]{3}$/.test(txt(r.destino)) && aero(r.destino, ctx).pais !== 'Brasil' ? ' (passaporte)' : '') + '.',
        'Leve o <b>cartão de crédito</b> usado na reserva: muitos hotéis pedem caução no check-in.',
        'Precisa chegar antes ou sair mais tarde? Fale com a gente que verificamos com o hotel.'];
    } else if (tipo === 'carro' && sub === 'locacao') {
      chamada = 'Seu carro'; destaque = txt(r.locadora);
      subtit = 'Confirmação de locação · ' + dataCurta(r.retData) + (txt(r.devData) ? ' a ' + dataCurta(r.devData) : '');
      var dias = difDias(r.retData, r.devData);
      if (txt(r.categoria)) det.push(['Categoria', r.categoria]);
      if (txt(r.seguro)) det.push(['Proteção', r.seguro]);
      cartao = cartaoReserva('<b>' + esc(r.locadora || 'Locadora') + '</b>', '',
        dataBloco(r.retData, r.horaRetirada, 'Retirada'), { icone: ICONE_CARRO.replace('<svg', '<svg style="width:22px;height:22px"'), texto: dias > 0 ? dias + (dias > 1 ? ' diárias' : ' diária') : '' },
        dataBloco(r.devData, r.horaDevolucao, 'Devolução', true), det);
      blocoExtra = '<section><div class="rotulo">Locais</div><div class="card">' +
        '<div class="kv"><span>Retirada</span><b>' + esc(r.retLocal || '—') + '</b></div>' +
        (txt(r.devLocal) && r.devLocal !== r.retLocal ? '<div class="kv"><span>Devolução</span><b>' + esc(r.devLocal) + '</b></div>' : '<div class="kv"><span>Devolução</span><b>No mesmo local</b></div>') +
        '</div></section>';
      rotPessoas = 'Condutor';
      dicas = ['Leve a <b>CNH</b> válida; no exterior, confira se o país exige a Permissão Internacional para Dirigir.',
        'Tenha um <b>cartão de crédito no nome do condutor</b> para a caução.',
        'Confira o <b>combustível</b> e fotografe o carro na retirada e na devolução.'];
      n = 0;
    } else if (tipo === 'carro') {
      var nomeSub = NOME_SUB[sub] || 'Transporte';
      chamada = sub === 'transfer' ? 'Seu transfer para' : 'Seu ' + nomeSub.toLowerCase() + ' para';
      destaque = cidadeDe(r.devLocal, ctx);
      subtit = 'Confirmação de ' + nomeSub.toLowerCase() + ' · ' + dataCurta(r.retData) + (txt(r.voltaData) && r.voltaData !== r.retData ? ' e ' + dataCurta(r.voltaData) : (txt(r.voltaData) ? ' · ida e volta' : '')) + (n > 1 ? ' · ' + n + ' passageiros' : '');
      var icone = (sub === 'transfer' ? ICONE_CARRO : ICONE_TREM).replace('<svg', '<svg style="width:22px;height:22px"');
      var trechoT = function (rot, emoji, dataT, orig, dest, hp, hc, op_, cat, cf) {
        var d2 = [];
        if (txt(cat) && !/^(ferry|trem|ônibus|onibus)$/i.test(cat)) d2.push([sub === 'transfer' ? 'Veículo' : 'Serviço', cat]);
        if (txt(op_)) d2.push(['Operadora', op_]);
        if (txt(cf) && conf.join(' / ') !== txt(cf)) d2.push(['Código', cf]);
        return cartaoReserva('<b>' + esc(rot) + '</b>' + (txt(op_) ? ' · ' + esc(op_) : ''), emoji + ' <b>' + esc(dataLonga(dataT)) + '</b>',
          localBloco('', hp, orig), { icone: icone, texto: nomeSub }, localBloco('', hc, dest, true), d2);
      };
      cartao = trechoT(txt(r.voltaData) ? 'Ida' : nomeSub, '🛫', r.retData, r.retLocal, r.devLocal, r.horaTransfer, r.horaChegadaTransp, r.locadora, r.categoria, '');
      if (txt(r.voltaData)) cartao += trechoT('Volta', '🛬', r.voltaData, r.voltaOrigem || r.devLocal, r.voltaDestino || r.retLocal, r.voltaHora, r.voltaHoraChegada, r.voltaOperadora || r.locadora, r.voltaCategoria || r.categoria, r.voltaConf);
      if (sub === 'transfer') dicas = ['Tenha o <b>código da reserva</b> à mão e o celular com internet na chegada.',
        'Se o voo atrasar, <b>avise no grupo</b>: a gente fala com a empresa.',
        'Confira o <b>ponto de encontro</b> com o motorista antes de sair da área de desembarque.'];
      else dicas = ['Chegue à ' + (sub === 'ferry' ? 'área de embarque do porto' : 'estação') + ' com <b>pelo menos 30 minutos</b> de folga.',
        'Tenha o <b>bilhete ou código</b> à mão e um documento com foto.',
        sub === 'trem' ? 'Confira a <b>plataforma</b> no painel da estação, ela costuma sair pouco antes da partida.' : 'Bagagens grandes podem ter regra própria: confira com a operadora.'];
    } else if (tipo === 'passeio') {
      chamada = 'Seu passeio em'; destaque = cidadeDe(r.destino, ctx);
      subtit = 'Confirmação de passeio · ' + dataCurta(r.dataPasseio) + (n > 1 ? ' · ' + n + ' pessoas' : '');
      if (txt(r.operadora)) det.push(['Operadora', r.operadora]);
      if (n) det.push(['Pessoas', String(n)]);
      cartao = cartaoReserva('<b>' + esc(r.passeioNome || 'Passeio') + '</b>', '',
        dataBloco(r.dataPasseio, r.hora, 'Data'), { icone: ICONE_PASSEIO.replace('<svg', '<svg style="width:22px;height:22px"'), texto: '' },
        '<div class="ponto dir"><div class="rot">Local</div><div class="hora" style="font-size:12pt">' + esc(cidadeDe(r.destino, ctx) || '—') + '</div></div>', det);
      if (txt(op.endereco)) blocoExtra = '<section><div class="rotulo">Ponto de encontro</div><div class="card">' + esc(op.endereco) + '</div></section>';
      rotPessoas = 'Participantes';
      dicas = ['Chegue ao ponto de encontro com <b>15 minutos de antecedência</b>.', 'Tenha o <b>código da reserva</b> à mão.'];
    } else if (tipo === 'seguro') {
      chamada = 'Seu seguro viagem'; destaque = txt(r.seguradora);
      var nd = difDias(r.seguroInicio, r.seguroFim) + 1;
      subtit = 'Apólice ' + (txt(r.seguroModalidade) === 'multiviagem' ? 'multiviagem' : 'de viagem') + ' · ' + dataCurta(r.seguroInicio) + ' a ' + dataCurta(r.seguroFim) + (n > 1 ? ' · ' + n + ' segurados' : '');
      if (txt(r.seguroPlano)) det.push(['Plano', r.seguroPlano]);
      if (txt(r.seguroCobertura)) det.push(['Cobertura', r.seguroCobertura]);
      if (txt(r.seguroTerritorio)) det.push(['Território', r.seguroTerritorio]);
      if (txt(r.seguroModalidade) === 'multiviagem' && txt(r.seguroDias)) det.push(['Por viagem', r.seguroDias + ' dias']);
      cartao = cartaoReserva('<b>' + esc(r.seguradora || 'Seguro viagem') + '</b>', '',
        dataBloco(r.seguroInicio, '', 'Início'), { icone: ICONE_ESCUDO.replace('<svg', '<svg style="width:22px;height:22px"'), texto: nd > 1 ? nd + ' dias de vigência' : '' },
        dataBloco(r.seguroFim, '', 'Fim', true), det);
      if (txt(r.seguroEmergencia) || txt(r.seguroCartao)) blocoExtra = '<section><div class="rotulo">Em caso de emergência</div><div class="eco" style="margin-top:0;font-size:10pt;padding:4mm 5mm">' +
        '<span>Central 24 h' + (txt(r.seguroCartao) ? '<br><small style="opacity:.7">Nº do cartão do segurado: ' + esc(r.seguroCartao) + '</small>' : '') + '</span><b style="font-size:14pt">' + esc(r.seguroEmergencia || '') + '</b></div></section>';
      rotPessoas = n > 1 ? 'Segurados' : 'Segurado'; rotCod = 'Apólice';
      dicas = ['Antes de ir a hospital ou clínica, <b>ligue para a central</b> (salvo risco de vida): eles indicam onde ser atendido.',
        'Guarde <b>recibos e laudos</b> de qualquer gasto para pedir reembolso.',
        'Salve o telefone da central no celular e tenha este PDF offline.'];
      rotRegras = 'Condições importantes';
    }
    var corpo = capa(ctx, chamada, destaque, subtit, conf, rotCod) +
      '<main><section><div class="rotulo">' + esc(tipo === 'hotel' ? 'Hospedagem' : tipo === 'seguro' ? 'Vigência' : tipo === 'passeio' ? 'Passeio' : (NOME_SUB[sub] || 'Transporte')) + '</div>' + cartao + '</section>' +
      blocoExtra +
      duasColunas(rotPessoas, pessoas(r, op, n, tipo === 'hotel' ? 'hóspede' : 'pessoa', tipo === 'hotel' ? 'hóspedes' : 'pessoas'), pag,
        tipo === 'seguro' ? 'Como usar' : 'Dicas', op.dicas ? lista(dicas) : '') +
      htmlRegras(op, rotRegras) + htmlRecado(op) + '</main>' + rodape(ctx, primeiro);
    return { compacto: false, corpo: corpo, arquivo: conf[0] || r.id || '' };
  }

  function montarHTML(r, op, ctx) {
    r = r || {}; ctx = ctx || {};
    op = op || opcoesPadrao(r);
    var m = txt(r.tipo) === 'voo' ? montarVoo(r, op, ctx) : montarOutro(r, op, ctx);
    var abre = '<div class="pdf-res' + (m.compacto ? ' compacto' : '') + '">';
    var rotTipo = { voo: 'Reserva', hotel: 'Hotel', carro: 'Transporte', transfer: 'Transfer', passeio: 'Passeio', seguro: 'Seguro' }[txt(r.tipo)] || 'Reserva';
    return {
      css: CSS,
      corpo: abre + m.corpo + '</div>',
      documento: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">' +
        '<style>@page{size:A4;margin:0}html,body{margin:0;background:#FBF9F5}' + CSS + '</style></head><body>' + abre + m.corpo + '</div></body></html>',
      nomeArquivo: (rotTipo + ' ' + m.arquivo + ' - ' + titulo(r.cliente)).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + '.pdf'
    };
  }

  // ── Geração do arquivo (só no navegador) ──
  // html2pdf vem do cdnjs na primeira vez; as fontes vêm do Google Fonts.
  var URL_HTML2PDF = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  var URL_FONTES = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&display=swap';
  var _libPromessa = null;
  function carregarLib() {
    if (raiz.html2pdf) return Promise.resolve(raiz.html2pdf);
    if (_libPromessa) return _libPromessa;
    _libPromessa = new Promise(function (ok, falha) {
      var sc = document.createElement('script');
      sc.src = URL_HTML2PDF;
      sc.onload = function () { raiz.html2pdf ? ok(raiz.html2pdf) : falha(new Error('html2pdf não carregou')); };
      sc.onerror = function () { _libPromessa = null; falha(new Error('não foi possível baixar o gerador de PDF')); };
      document.head.appendChild(sc);
    });
    return _libPromessa;
  }
  function carregarFontes() {
    if (!document.querySelector('link[data-pdf-res-fontes]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = URL_FONTES; l.setAttribute('data-pdf-res-fontes', '1');
      document.head.appendChild(l);
    }
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var pesos = ['400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"', '300 12px Manrope', '400 12px Manrope', '600 12px Manrope', '700 12px Manrope'];
    var espera = Promise.all(pesos.map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    // Sem internet para as fontes, segue com as de reserva depois de 4 s
    return Promise.race([espera, new Promise(function (ok) { setTimeout(ok, 4000); })]);
  }
  function gerarPDF(r, op, ctx) {
    var m = montarHTML(r, op, ctx);
    return Promise.all([carregarLib(), carregarFontes()]).then(function (res) {
      var h2p = res[0];
      var caixa = document.createElement('div');
      caixa.style.cssText = 'position:fixed;left:0;top:0;width:210mm;z-index:-1;pointer-events:none';
      caixa.innerHTML = '<style>' + m.css + '.pdf-res{min-height:296mm}</style>' + m.corpo;
      document.body.appendChild(caixa);
      var alvo = caixa.querySelector('.pdf-res');
      var opcoes = {
        margin: 0,
        filename: m.nomeArquivo,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#FBF9F5', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.trecho', 'section', 'footer', '.capa', '.card'] }
      };
      return h2p().set(opcoes).from(alvo).outputPdf('blob').then(function (blob) {
        caixa.remove();
        return new Promise(function (ok) {
          var fr = new FileReader();
          fr.onload = function () { ok({ blob: blob, base64: String(fr.result).split(',')[1], nome: m.nomeArquivo, tamanho: blob.size }); };
          fr.readAsDataURL(blob);
        });
      }, function (e) { caixa.remove(); throw e; });
    });
  }

  var api = { opcoesPadrao: opcoesPadrao, montarHTML: montarHTML, gerarPDF: gerarPDF, carregarFontes: carregarFontes, nomePax: nomePax, _num: num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.PdfReserva = api;
})(typeof window !== 'undefined' ? window : this);
