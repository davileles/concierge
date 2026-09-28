// ══════════════════════════════════════════════════════════════════════════
//  mapa.js — converte as respostas do ds160.html (registro.dados) nos itens
//  que a extensão preenche no site do consulado (ceac.state.gov).
//
//  Cada item: { id, secao, r (rótulo do DS-160), pt (pergunta do nosso form),
//    mostra (valor exibido/colado), campos: [{ s, t, v }], alerta, nota, tr }
//    s = sufixo do id do campo no DS-160 (sem "ctl00_SiteContentPlaceHolder_FormView1_")
//    t = text | select | radio | check
//    v = valor (text) ou lista de candidatos (select: casa por value ou texto;
//        candidato com "~" na frente casa por "contém" no texto da opção)
//    tr = texto em português que precisa de tradução — os campos com v:null
//         recebem a tradução quando ela existir.
//  Item sem `campos` só tem modo manual (clicar no campo do site e depois no valor).
//
//  Sem dependências: roda no painel da extensão e no Node (testes).
// ══════════════════════════════════════════════════════════════════════════
(function (raiz) {
'use strict';

var SECOES = [
  'Personal 1', 'Personal 2', 'Travel', 'Travel Companions', 'Previous U.S. Travel',
  'Address and Phone', 'Passport', 'U.S. Contact', 'Family: Relatives', 'Family: Spouse',
  'Work / Education: Present', 'Work / Education: Previous', 'Work / Education: Additional',
  'Security and Background'
];

// ── utilidades ─────────────────────────────────────────────────────────────
function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function up(s) { return semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim(); }
function digitos(s) { return String(s || '').replace(/\D/g, ''); }
function sim(v) { return v === 'Sim'; }
function temValor(v) { return v != null && String(v).trim() !== ''; }
function naoSei(v) { return /n[aã]o sei/i.test(String(v || '')); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
var MESES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parteData(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return { a: m[1], m: Number(m[2]), d: Number(m[3]) };
}
function fmtData(iso) {
  var p = parteData(iso);
  return p ? pad2(p.d) + '-' + MESES[p.m - 1] + '-' + p.a : '';
}
// Data do DS-160 = 3 campos: dia (select), mês (select), ano (texto).
function camposData(sDia, sMes, sAno, iso) {
  var p = parteData(iso);
  if (!p) return [];
  return [
    { s: sDia, t: 'select', v: [String(p.d), pad2(p.d)] },
    { s: sMes, t: 'select', v: [String(p.m), pad2(p.m), MESES[p.m - 1]] },
    { s: sAno, t: 'text', v: p.a }
  ];
}
function radio(sufixo, valorSim) { return { s: sufixo + (valorSim ? '_0' : '_1'), t: 'radio' }; }
function check(sufixo) { return { s: sufixo, t: 'check', v: true }; }
function diasEntre(a, b) {
  var pa = parteData(a), pb = parteData(b);
  if (!pa || !pb) return 0;
  var ta = Date.UTC(+pa.a, pa.m - 1, pa.d), tb = Date.UTC(+pb.a, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86400000);
}
// Nome brasileiro → DS-160: primeiro nome em "given", o resto em "surname".
function dividirNome(nome) {
  var p = up(nome).split(' ').filter(Boolean);
  if (!p.length) return { given: '', surname: '' };
  if (p.length === 1) return { given: p[0], surname: p[0] };
  return { given: p[0], surname: p.slice(1).join(' ') };
}
function lista(v) {
  return String(v || '').split(/\s*(?:,|;|\/|\n|\s+e\s+)\s*/i).map(function (x) { return x.trim(); }).filter(Boolean);
}
function telefoneBR(v) {
  var d = digitos(v);
  if (!d) return '';
  if (d.length >= 12 && d.indexOf('55') === 0) return d;
  return '55' + d;
}

// ── países (texto em português → nome no DS-160) ──────────────────────────
var PAISES = {
  'africa do sul': 'SOUTH AFRICA', 'alemanha': 'GERMANY', 'angola': 'ANGOLA', 'arabia saudita': 'SAUDI ARABIA',
  'argentina': 'ARGENTINA', 'aruba': 'ARUBA', 'australia': 'AUSTRALIA', 'austria': 'AUSTRIA', 'bahamas': 'BAHAMAS',
  'belgica': 'BELGIUM', 'bolivia': 'BOLIVIA', 'brasil': 'BRAZIL', 'bulgaria': 'BULGARIA', 'cabo verde': 'CABO VERDE',
  'canada': 'CANADA', 'catar': 'QATAR', 'qatar': 'QATAR', 'chile': 'CHILE', 'china': 'CHINA', 'chipre': 'CYPRUS',
  'colombia': 'COLOMBIA', 'coreia do sul': '~KOREA, REPUBLIC OF', 'coreia': '~KOREA, REPUBLIC OF',
  'costa rica': 'COSTA RICA', 'croacia': 'CROATIA', 'cuba': 'CUBA', 'curacao': 'CURACAO', 'dinamarca': 'DENMARK',
  'egito': 'EGYPT', 'emirados arabes': '~UNITED ARAB EMIRATES', 'emirados arabes unidos': '~UNITED ARAB EMIRATES',
  'dubai': '~UNITED ARAB EMIRATES', 'equador': 'ECUADOR', 'escocia': 'UNITED KINGDOM', 'eslovaquia': 'SLOVAKIA',
  'eslovenia': 'SLOVENIA', 'espanha': 'SPAIN', 'estados unidos': 'UNITED STATES OF AMERICA', 'eua': 'UNITED STATES OF AMERICA',
  'estonia': 'ESTONIA', 'filipinas': 'PHILIPPINES', 'finlandia': 'FINLAND', 'franca': 'FRANCE', 'grecia': 'GREECE',
  'guatemala': 'GUATEMALA', 'holanda': 'NETHERLANDS', 'paises baixos': 'NETHERLANDS', 'hong kong': '~HONG KONG',
  'hungria': 'HUNGARY', 'india': 'INDIA', 'indonesia': 'INDONESIA', 'inglaterra': 'UNITED KINGDOM', 'reino unido': 'UNITED KINGDOM',
  'irlanda': 'IRELAND', 'islandia': 'ICELAND', 'israel': 'ISRAEL', 'italia': 'ITALY', 'jamaica': 'JAMAICA', 'japao': 'JAPAN',
  'jordania': 'JORDAN', 'letonia': 'LATVIA', 'libano': 'LEBANON', 'lituania': 'LITHUANIA', 'luxemburgo': 'LUXEMBOURG',
  'malasia': 'MALAYSIA', 'maldivas': 'MALDIVES', 'malta': 'MALTA', 'marrocos': 'MOROCCO', 'mexico': 'MEXICO',
  'monaco': 'MONACO', 'mocambique': 'MOZAMBIQUE', 'noruega': 'NORWAY', 'nova zelandia': 'NEW ZEALAND', 'panama': 'PANAMA',
  'paraguai': 'PARAGUAY', 'peru': 'PERU', 'polonia': 'POLAND', 'portugal': 'PORTUGAL', 'republica dominicana': 'DOMINICAN REPUBLIC',
  'republica tcheca': '~CZECH', 'tchequia': '~CZECH', 'romenia': 'ROMANIA', 'russia': 'RUSSIA', 'singapura': 'SINGAPORE',
  'suecia': 'SWEDEN', 'suica': 'SWITZERLAND', 'tailandia': 'THAILAND', 'taiwan': 'TAIWAN', 'turquia': 'TURKEY',
  'ucrania': 'UKRAINE', 'uruguai': 'URUGUAY', 'vaticano': '~HOLY SEE', 'venezuela': 'VENEZUELA', 'vietna': 'VIETNAM'
};
function paisDs(pt) {
  var k = semAcento(pt).toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (!k) return null;
  if (PAISES[k]) return PAISES[k];
  if (k === 'brasileira' || k === 'brasileiro') return 'BRAZIL';
  return null;
}
function candidatosPais(pt) {
  var ds = paisDs(pt);
  if (!ds) return null;
  if (ds === 'BRAZIL') return ['BRZL', 'BRAZIL'];
  return [ds];
}

// ── idiomas ────────────────────────────────────────────────────────────────
var IDIOMAS = {
  'portugues': 'PORTUGUESE', 'ingles': 'ENGLISH', 'espanhol': 'SPANISH', 'frances': 'FRENCH', 'italiano': 'ITALIAN',
  'alemao': 'GERMAN', 'japones': 'JAPANESE', 'mandarim': 'CHINESE (MANDARIN)', 'chines': 'CHINESE', 'russo': 'RUSSIAN',
  'arabe': 'ARABIC', 'hebraico': 'HEBREW', 'coreano': 'KOREAN', 'holandes': 'DUTCH', 'libras': 'BRAZILIAN SIGN LANGUAGE',
  'grego': 'GREEK', 'polones': 'POLISH', 'sueco': 'SWEDISH', 'turco': 'TURKISH', 'latim': 'LATIN'
};
function idiomaDs(pt) {
  var k = semAcento(pt).toLowerCase().replace(/[^a-z ]/g, '').trim();
  return IDIOMAS[k] || null;
}

// ── estados brasileiros (nome por extenso sem acento) ─────────────────────
var UF_SIGLA = { AC:'ACRE', AL:'ALAGOAS', AP:'AMAPA', AM:'AMAZONAS', BA:'BAHIA', CE:'CEARA', DF:'DISTRITO FEDERAL',
  ES:'ESPIRITO SANTO', GO:'GOIAS', MA:'MARANHAO', MT:'MATO GROSSO', MS:'MATO GROSSO DO SUL', MG:'MINAS GERAIS', PA:'PARA',
  PB:'PARAIBA', PR:'PARANA', PE:'PERNAMBUCO', PI:'PIAUI', RJ:'RIO DE JANEIRO', RN:'RIO GRANDE DO NORTE',
  RS:'RIO GRANDE DO SUL', RO:'RONDONIA', RR:'RORAIMA', SC:'SANTA CATARINA', SP:'SAO PAULO', SE:'SERGIPE', TO:'TOCANTINS' };
function estadoBR(v) {
  var u = up(v);
  if (UF_SIGLA[u]) return UF_SIGLA[u];
  return u;
}

// ── relações / status ──────────────────────────────────────────────────────
function relacao(pt, opcoes) {
  var t = semAcento(pt).toLowerCase();
  function tem(re) { return re.test(t); }
  var r;
  if (tem(/marido|esposa|conjuge|companheir/)) r = 'SPOUSE';
  else if (tem(/\bfilh/)) r = 'CHILD';
  else if (tem(/\bpai\b|\bmae\b|\bpais\b|genitor/)) r = 'PARENT';
  else if (tem(/irma/)) r = 'SIBLING';
  else if (tem(/\btio|\btia|prim|avo|sobrinh|cunhad|sogr|genro|nora|neto|neta|parente/)) r = 'OTHER RELATIVE';
  else if (tem(/noiv/)) r = 'FIANCE';
  else if (tem(/amig/)) r = 'FRIEND';
  else if (tem(/chefe|empregador|patrao/)) r = 'EMPLOYER';
  else if (tem(/socio|cliente|fornecedor|colega|negocio|parceir/)) r = 'BUSINESS ASSOCIATE';
  else if (tem(/escola|faculdade|universidade/)) r = 'SCHOOL OFFICIAL';
  else r = 'OTHER';
  // Adapta ao vocabulário de cada lista do DS-160.
  if (opcoes === 'contato') {
    if (r === 'SPOUSE') return ['SPOUSE', '~RELATIVE'];
    if (['CHILD', 'PARENT', 'SIBLING', 'OTHER RELATIVE', 'FIANCE'].indexOf(r) > -1) return ['RELATIVE', '~RELATIVE'];
    return [r, '~' + r];
  }
  if (opcoes === 'pagador' || opcoes === 'acompanhante') {
    if (r === 'SIBLING' || r === 'FIANCE') r = 'OTHER RELATIVE';
    if (opcoes === 'pagador' && (r === 'EMPLOYER' || r === 'BUSINESS ASSOCIATE' || r === 'SCHOOL OFFICIAL')) r = 'OTHER';
    if (opcoes === 'acompanhante' && (r === 'EMPLOYER' || r === 'SCHOOL OFFICIAL')) r = 'OTHER';
    return [r, '~' + r];
  }
  if (opcoes === 'parente') {
    if (r === 'FIANCE') return ['~FIANC'];
    if (r === 'SPOUSE' || r === 'CHILD' || r === 'SIBLING') return [r, '~' + r];
    return null;
  }
  return [r];
}
function statusEUA(pt) {
  if (!pt) return null;
  if (/cidad/i.test(pt)) return ['~CITIZEN'];
  if (/green|permanente/i.test(pt)) return ['~PERMANENT'];
  if (/tempor|outro/i.test(pt)) return ['~NONIMMIGRANT'];
  return ['~DON'];
}

// ══════════════════════════════════════════════════════════════════════════
function montarItens(dados) {
  var d = dados || {};
  var itens = [];
  var secao = SECOES[0];
  function S(nome) { secao = nome; }
  function add(o) {
    o.secao = o.secao || secao;
    o.id = o.id || ('i' + itens.length);
    if (o.mostra == null) o.mostra = '';
    o.mostra = String(o.mostra);
    if (!o.alerta && naoSei(o.origem)) o.alerta = 'Cliente respondeu "não sei" — confirmar antes de preencher.';
    delete o.origem;
    itens.push(o);
    return o;
  }
  function simNao(id, r, pt, v, sufixo) {
    if (!temValor(v)) return null;
    return add({ id: id, r: r, pt: pt, mostra: sim(v) ? 'YES' : 'NO', origem: v, campos: [radio(sufixo, sim(v))] });
  }
  function texto(id, r, pt, v, sufixo, extra) {
    if (!temValor(v)) return null;
    var val = up(v);
    var o = { id: id, r: r, pt: pt, mostra: val, origem: v, campos: sufixo ? [{ s: sufixo, t: 'text', v: val }] : undefined };
    if (extra) for (var k in extra) o[k] = extra[k];
    return add(o);
  }
  function traduzivel(id, r, pt, v, sufixo) {
    if (!temValor(v)) return null;
    return add({ id: id, r: r, pt: pt, mostra: String(v).trim(), origem: v, tr: String(v).trim(),
      campos: sufixo ? [{ s: sufixo, t: 'text', v: null }] : undefined });
  }
  function data(id, r, pt, iso, sDia, sMes, sAno) {
    if (!parteData(iso)) return null;
    return add({ id: id, r: r, pt: pt, mostra: fmtData(iso), campos: camposData(sDia, sMes, sAno, iso) });
  }
  function pais(id, r, pt, v, sufixo) {
    if (!temValor(v)) return null;
    var c = candidatosPais(v);
    return add({ id: id, r: r, pt: pt, mostra: c ? c[c.length - 1].replace(/^~/, '') : up(v), origem: v,
      campos: c ? [{ s: sufixo, t: 'select', v: c }] : undefined,
      nota: c ? null : 'País não reconhecido — escolha na lista do site.' });
  }
  function naoSeAplica(id, r, sufixoCheck, nota) {
    return add({ id: id, r: r, pt: '—', mostra: 'DOES NOT APPLY', campos: [check(sufixoCheck)], nota: nota || null });
  }

  // ── PERSONAL 1 ──────────────────────────────────────────────────────────
  S('Personal 1');
  texto('sobrenome', 'Surnames', 'Sobrenome(s)', d.sobrenome, 'tbxAPP_SURNAME');
  texto('nomes', 'Given Names', 'Nome(s)', d.nomes, 'tbxAPP_GIVEN_NAME');
  naoSeAplica('nomeNativo', 'Full Name in Native Alphabet', 'cbexAPP_FULL_NAME_NATIVE_NA');
  if (temValor(d.outrosNomes)) {
    simNao('outrosNomes', 'Have you ever used other names?', 'Já usou outro nome?', d.outrosNomes, 'rblOtherNames');
    if (sim(d.outrosNomes) && temValor(d.outrosNomesQuais)) {
      var alias = lista(d.outrosNomesQuais);
      alias.slice(0, 4).forEach(function (nm, i) {
        var dv = dividirNome(nm);
        var ctl = 'DListAlias_ctl' + pad2(i) + '_';
        add({ id: 'alias' + i, r: 'Other Name ' + (i + 1), pt: 'Outro nome usado', mostra: dv.surname + ' / ' + dv.given, origem: nm,
          campos: [{ s: ctl + 'tbxSURNAME', t: 'text', v: dv.surname }, { s: ctl + 'tbxGIVEN_NAME', t: 'text', v: dv.given }],
          nota: 'Confira a divisão sobrenome / nome.' + (i > 0 ? ' Se a linha não existir, clique em "Add Another" no site.' : '') });
      });
    }
  }
  add({ id: 'telecode', r: 'Do you have a telecode that represents your name?', pt: '—', mostra: 'NO', campos: [radio('rblTelecodeQuestion', false)] });
  if (temValor(d.sexo)) {
    var m = d.sexo === 'Masculino';
    add({ id: 'sexo', r: 'Sex', pt: 'Sexo', mostra: m ? 'MALE' : 'FEMALE',
      campos: [{ s: 'ddlAPP_GENDER', t: 'select', v: m ? ['M', 'MALE'] : ['F', 'FEMALE'] }] });
  }
  if (temValor(d.estadoCivil)) {
    var EC = {
      'Casado(a)': ['M', 'MARRIED'], 'Solteiro(a)': ['S', 'SINGLE'], 'Divorciado(a)': ['D', 'DIVORCED'],
      'Viúvo(a)': ['W', 'WIDOWED'], 'Separado(a) judicialmente': ['L', 'LEGALLY SEPARATED'],
      'União estável': ['~COMMON LAW', '~CIVIL UNION']
    };
    var ec = EC[d.estadoCivil];
    add({ id: 'estadoCivil', r: 'Marital Status', pt: 'Estado civil', mostra: ec ? ec[ec.length - 1].replace(/^~/, '') : up(d.estadoCivil),
      campos: ec ? [{ s: 'ddlAPP_MARITAL_STATUS', t: 'select', v: ec }] : undefined,
      nota: d.estadoCivil === 'União estável' ? 'União estável: confira se é COMMON LAW MARRIAGE ou CIVIL UNION/DOMESTIC PARTNERSHIP.' : null });
  }
  data('nasc', 'Date of Birth', 'Data de nascimento', d.nasc, 'ddlDOBDay', 'ddlDOBMonth', 'tbxDOBYear');
  texto('cidadeNasc', 'Place of Birth: City', 'Cidade de nascimento', d.cidadeNasc, 'tbxAPP_POB_CITY');
  if (temValor(d.estadoNasc)) texto('estadoNasc', 'Place of Birth: State/Province', 'Estado de nascimento', estadoBR(d.estadoNasc), 'tbxAPP_POB_ST_PROVINCE');
  else naoSeAplica('estadoNascNA', 'Place of Birth: State/Province', 'cbexAPP_POB_ST_PROVINCE_NA');
  pais('paisNasc', 'Place of Birth: Country/Region', 'País de nascimento', d.paisNasc || 'Brasil', 'ddlAPP_POB_CNTRY');

  // ── PERSONAL 2 ──────────────────────────────────────────────────────────
  S('Personal 2');
  pais('nacionalidade', 'Country/Region of Origin (Nationality)', 'Nacionalidade', d.nacionalidade || 'Brasil', 'ddlAPP_NATL');
  simNao('outraNac', 'Do you hold or have you held any nationality other than the one above?', 'Outra nacionalidade?', d.outraNacionalidade, 'rblAPP_OTH_NATL_IND');
  if (sim(d.outraNacionalidade)) {
    pais('outraNacQual', 'Other Country/Region of Origin', 'Qual país?', d.outraNacionalidadeQual, 'dtlOTHER_NATL_ctl00_ddlOTHER_NATL');
    var temPpt = temValor(d.outraNacionalidadePassaporte);
    add({ id: 'outraNacPptInd', r: 'Do you hold a passport for the other country?', pt: 'Passaporte desse país',
      mostra: temPpt ? 'YES' : 'NO', campos: [radio('dtlOTHER_NATL_ctl00_rblOTHER_PPT_IND', temPpt)] });
    if (temPpt) texto('outraNacPpt', 'Passport Number', 'Nº do passaporte', d.outraNacionalidadePassaporte, 'dtlOTHER_NATL_ctl00_tbxOTHER_PPT_NUM');
  }
  simNao('resOutro', 'Are you a permanent resident of a country other than your country of origin?', 'Residente de outro país?', d.residenteOutroPais, 'rblPermResOtherCntryInd');
  if (sim(d.residenteOutroPais)) pais('resOutroQual', 'Other Permanent Residence Country', 'Qual país?', d.residenteOutroPaisQual, 'dtlOthPermResCntry_ctl00_ddlOthPermResCntry');
  if (temValor(d.cpf)) add({ id: 'cpf', r: 'National Identification Number', pt: 'CPF', mostra: digitos(d.cpf), campos: [{ s: 'tbxAPP_NATIONAL_ID', t: 'text', v: digitos(d.cpf) }] });
  naoSeAplica('ssn', 'U.S. Social Security Number', 'cbexAPP_SSN_NA');
  naoSeAplica('taxid', 'U.S. Taxpayer ID Number', 'cbexAPP_TAX_ID_NA');

  // ── TRAVEL ──────────────────────────────────────────────────────────────
  S('Travel');
  add({ id: 'proposito', r: 'Purpose of Trip to the U.S.', pt: 'Motivo', mostra: 'TEMP. BUSINESS PLEASURE VISITOR (B)',
    campos: [{ s: 'dlPrincipalAppTravel_ctl00_ddlPurposeOfTrip', t: 'select', v: ['B', '~BUSINESS PLEASURE', '~(B)'] }] });
  if (temValor(d.motivo)) {
    var sub = d.motivo === 'Negócios' ? ['B1-CF', '~(B1)'] :
      d.motivo === 'Turismo e negócios' ? ['B1-B2', '~B1/B2'] : ['B2-TR', '~(B2)'];
    var subTxt = d.motivo === 'Negócios' ? 'BUSINESS/CONFERENCE (B1)' :
      d.motivo === 'Turismo e negócios' ? 'BUSINESS & TOURISM (TEMPORARY VISITOR) (B1/B2)' : 'TOURISM/MEDICAL TREATMENT (B2)';
    add({ id: 'subproposito', r: 'Specify', pt: 'Motivo: ' + d.motivo, mostra: subTxt,
      campos: [{ s: 'dlPrincipalAppTravel_ctl00_ddlOtherPurpose', t: 'select', v: sub }] });
  }
  if (temValor(d.passagemComprada)) {
    simNao('planoEspecifico', 'Have you made specific travel plans?', 'Já tem passagem comprada?', d.passagemComprada, 'rblSpecificTravel');
    if (sim(d.passagemComprada)) {
      data('chegadaEsp', 'Date of Arrival in U.S.', 'Data de chegada', d.chegada, 'ddlARRIVAL_US_DTEDay', 'ddlARRIVAL_US_DTEMonth', 'tbxARRIVAL_US_DTEYear');
      var cid = lista(d.cidadeDestino);
      if (cid[0]) texto('chegadaCidade', 'Arrival City', 'Cidade de chegada', cid[0], 'tbxArriveCity');
      data('saidaEsp', 'Date of Departure from U.S.', 'Data de saída', d.saida, 'ddlDEPARTURE_US_DTEDay', 'ddlDEPARTURE_US_DTEMonth', 'tbxDEPARTURE_US_DTEYear');
      if (cid.length) texto('saidaCidade', 'Departure City', 'Cidade de partida', cid[cid.length - 1], 'tbxDepartCity');
      cid.slice(0, 5).forEach(function (c, i) {
        texto('local' + i, 'Location you plan to visit ' + (i + 1), 'Cidade(s) que vai visitar', c, 'dtlTravelLoc_ctl' + pad2(i) + '_tbxSPECTRAVEL_LOCATION',
          i > 0 ? { nota: 'Se a linha não existir, clique em "Add Another" no site.' } : null);
      });
    } else {
      data('chegadaPrev', 'Intended Date of Arrival', 'Data prevista de chegada', d.chegada, 'ddlTRAVEL_DTEDay', 'ddlTRAVEL_DTEMonth', 'tbxTRAVEL_DTEYear');
      var dias = diasEntre(d.chegada, d.saida);
      if (dias > 0) add({ id: 'permanencia', r: 'Intended Length of Stay in U.S.', pt: 'Da chegada à saída', mostra: dias + ' DAY(S)',
        campos: [{ s: 'tbxTRAVEL_LOS', t: 'text', v: String(dias) }, { s: 'ddlTRAVEL_LOS_CD', t: 'select', v: ['D', '~DAY'] }] });
    }
  }
  if (temValor(d.hospedagem)) add({ id: 'hospedagem', r: 'Address Where You Will Stay in the U.S.', pt: 'Endereço de hospedagem',
    mostra: up(d.hospedagem), origem: d.hospedagem, nota: 'Separe rua, cidade, estado e ZIP: clique em cada campo do site e use ↘ com o trecho certo, ou digite.' });
  else add({ id: 'hospedagem', r: 'Address Where You Will Stay in the U.S.', pt: 'Endereço de hospedagem', mostra: '',
    alerta: 'Cliente não informou a hospedagem — definir o hotel antes.' });

  if (temValor(d.pagador)) {
    var PG = { 'Eu mesmo(a)': ['S', 'SELF'], 'Empresa / empregador': ['P', '~PRESENT EMPLOYER'] };
    var pg = PG[d.pagador] || ['O', 'OTHER PERSON'];
    add({ id: 'pagador', r: 'Person/Entity Paying for Your Trip', pt: 'Quem vai pagar: ' + d.pagador, mostra: pg[pg.length - 1].replace(/^~/, ''),
      campos: [{ s: 'ddlWhoIsPaying', t: 'select', v: pg }] });
    if (d.pagador !== 'Eu mesmo(a)' && d.pagador !== 'Empresa / empregador' && temValor(d.pagadorNome)) {
      var pn = dividirNome(d.pagadorNome);
      add({ id: 'pagadorSob', r: 'Surnames of Person Paying', pt: 'Nome de quem paga', mostra: pn.surname, campos: [{ s: 'tbxPayerSurname', t: 'text', v: pn.surname }], nota: 'Confira a divisão sobrenome / nome.' });
      add({ id: 'pagadorNome', r: 'Given Names of Person Paying', pt: 'Nome de quem paga', mostra: pn.given, campos: [{ s: 'tbxPayerGivenName', t: 'text', v: pn.given }] });
      if (temValor(d.pagadorTel)) add({ id: 'pagadorTel', r: 'Telephone Number', pt: 'Telefone de quem paga', mostra: telefoneBR(d.pagadorTel), campos: [{ s: 'tbxPayerPhone', t: 'text', v: telefoneBR(d.pagadorTel) }] });
      if (temValor(d.pagadorEmail)) add({ id: 'pagadorEmail', r: 'Email Address', pt: 'E-mail de quem paga', mostra: String(d.pagadorEmail).trim(), campos: [{ s: 'tbxPAYER_EMAIL_ADDR', t: 'text', v: String(d.pagadorEmail).trim() }] });
      else add({ id: 'pagadorEmailNA', r: 'Email Address (payer)', pt: 'E-mail de quem paga', mostra: 'DOES NOT APPLY', nota: 'Sem e-mail: marque "Does Not Apply" no site.' });
      var parente = d.pagador === 'Cônjuge' ? 'cônjuge' : d.pagador === 'Pais' ? 'pai' : d.pagadorParentesco;
      var rel = relacao(parente, 'pagador');
      add({ id: 'pagadorRel', r: 'Relationship to You', pt: 'Relação: ' + (d.pagadorParentesco || d.pagador), mostra: rel[0], campos: [{ s: 'ddlPayerRelationship', t: 'select', v: rel }] });
      if (temValor(d.pagadorMesmoEndereco)) simNao('pagadorEnd', 'Is the address of the party paying the same as your Home or Mailing Address?', 'Mora no mesmo endereço?', d.pagadorMesmoEndereco, 'rblPayerAddrSameAsInd');
      if (d.pagadorMesmoEndereco === 'Não') texto('pagadorEndereco', 'Payer Address', 'Endereço de quem paga', d.pagadorEndereco, null, { nota: 'Separe rua, cidade, estado e CEP nos campos do site.' });
    }
    if (d.pagador === 'Empresa / empregador' && temValor(d.pagadorNome)) texto('pagadorEmpresa', 'Name of Company/Organization Paying', 'Empresa que paga', d.pagadorNome, 'tbxPayingCompany');
  }

  // ── TRAVEL COMPANIONS ───────────────────────────────────────────────────
  S('Travel Companions');
  if (temValor(d.acompanhado)) {
    simNao('acompanhado', 'Are there other persons traveling with you?', 'Vai viajar com outras pessoas?', d.acompanhado, 'rblOtherPersonsTravelingWithYou');
    if (sim(d.acompanhado)) {
      add({ id: 'grupo', r: 'Are you traveling as part of a group or organization?', pt: '—', mostra: 'NO', campos: [radio('rblGroupTravel', false)] });
      (Array.isArray(d.acompanhantes) ? d.acompanhantes : []).slice(0, 10).forEach(function (a, i) {
        if (!a || !temValor(a.nome)) return;
        var n = dividirNome(a.nome), ctl = 'dtlTravelCompanions_ctl' + pad2(i) + '_';
        var rel = relacao(a.parentesco, 'acompanhante');
        add({ id: 'acomp' + i, r: 'Companion ' + (i + 1), pt: 'Acompanhante: ' + a.nome + (a.parentesco ? ' (' + a.parentesco + ')' : ''),
          mostra: n.surname + ' / ' + n.given + ' · ' + rel[0], origem: a.nome,
          campos: [{ s: ctl + 'tbxSurname', t: 'text', v: n.surname }, { s: ctl + 'tbxGivenName', t: 'text', v: n.given }, { s: ctl + 'ddlRelationship', t: 'select', v: rel }],
          nota: 'Confira a divisão sobrenome / nome.' + (i > 0 ? ' Se a linha não existir, clique em "Add Another" no site.' : '') });
      });
    }
  }

  // ── PREVIOUS U.S. TRAVEL ────────────────────────────────────────────────
  S('Previous U.S. Travel');
  simNao('esteveEUA', 'Have you ever been in the U.S.?', 'Já esteve nos EUA?', d.esteveEUA, 'rblPREV_US_TRAVEL_IND');
  if (sim(d.esteveEUA)) {
    (Array.isArray(d.visitas) ? d.visitas : []).slice(0, 5).forEach(function (v, i) {
      if (!v) return;
      var ctl = 'dtlPREV_US_VISIT_ctl' + pad2(i) + '_';
      var campos = camposData(ctl + 'ddlPREV_US_VISIT_DTEDay', ctl + 'ddlPREV_US_VISIT_DTEMonth', ctl + 'tbxPREV_US_VISIT_DTEYear', v.chegada);
      var mm = /(\d+)\s*(dia|semana|m[eê]s|mes|ano)?/i.exec(String(v.duracao || ''));
      var un = mm && mm[2] ? semAcento(mm[2]).toLowerCase() : 'dia';
      var cod = /^sem/.test(un) ? ['W', '~WEEK'] : /^m/.test(un) ? ['M', '~MONTH'] : /^ano/.test(un) ? ['Y', '~YEAR'] : ['D', '~DAY'];
      if (mm) campos.push({ s: ctl + 'tbxPREV_US_VISIT_LOS', t: 'text', v: mm[1] }, { s: ctl + 'ddlPREV_US_VISIT_LOS_CD', t: 'select', v: cod });
      if (!campos.length) return;
      add({ id: 'visita' + i, r: 'Previous visit ' + (i + 1), pt: 'Viagem: ' + fmtData(v.chegada) + ' · ' + (v.duracao || ''),
        mostra: fmtData(v.chegada) + (mm ? ' · ' + mm[1] + ' ' + cod[1].replace('~', '') + '(S)' : ''), origem: v.duracao, campos: campos,
        nota: i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : null });
    });
    simNao('cnhEUA', 'Do you or did you ever hold a U.S. Driver\'s License?', 'Carteira americana?', d.cnhEUA, 'rblPREV_US_DRIVER_LIC_IND');
    if (sim(d.cnhEUA)) {
      texto('cnhNum', 'Driver\'s License Number', 'Número da carteira', d.cnhEUANumero, 'dtlUS_DRIVER_LICENSE_ctl00_tbxUS_DRIVER_LICENSE');
      if (temValor(d.cnhEUAEstado)) add({ id: 'cnhEstado', r: 'State of Driver\'s License', pt: 'Estado americano', mostra: up(d.cnhEUAEstado),
        campos: [{ s: 'dtlUS_DRIVER_LICENSE_ctl00_ddlUS_DRIVER_LICENSE_STATE', t: 'select', v: [up(d.cnhEUAEstado), '~' + up(d.cnhEUAEstado)] }] });
    }
  }
  simNao('teveVisto', 'Have you ever been issued a U.S. Visa?', 'Já teve visto?', d.teveVisto, 'rblPREV_VISA_IND');
  if (sim(d.teveVisto)) {
    data('vistoData', 'Date Last Visa Was Issued', 'Emissão do último visto', d.vistoEmissao, 'ddlPREV_VISA_ISSUED_DTEDay', 'ddlPREV_VISA_ISSUED_DTEMonth', 'tbxPREV_VISA_ISSUED_DTEYear');
    if (temValor(d.vistoNumero)) texto('vistoNum', 'Visa Number', 'Número do visto', d.vistoNumero, 'tbxPREV_VISA_FOIL_NUMBER');
    else naoSeAplica('vistoNumNA', 'Visa Number', 'cbxPREV_VISA_FOIL_NUMBER_NA', 'Número do visto não informado — confirme com a foto do visto.');
    simNao('vistoTipo', 'Are you applying for the same type of visa?', 'Mesmo tipo?', d.vistoMesmoTipo, 'rblPREV_VISA_SAME_TYPE_IND');
    simNao('vistoPais', 'Are you applying in the same country where the visa was issued?', 'Emitido no Brasil?', d.vistoMesmoPais, 'rblPREV_VISA_SAME_CNTRY_IND');
    simNao('vistoDig', 'Have you been ten-printed?', 'Colheu as 10 digitais?', d.vistoDigitais, 'rblPREV_VISA_TEN_PRINT_IND');
    simNao('vistoPerd', 'Has your U.S. Visa ever been lost or stolen?', 'Perdido ou roubado?', d.vistoPerdido, 'rblPREV_VISA_LOST_IND');
    simNao('vistoCanc', 'Has your U.S. Visa ever been cancelled or revoked?', 'Cancelado ou revogado?', d.vistoCancelado, 'rblPREV_VISA_CANCELLED_IND');
    if (sim(d.vistoPerdido) || sim(d.vistoCancelado)) add({ id: 'vistoProb', r: 'Explain (lost/cancelled visa)', pt: 'Visto perdido/cancelado', mostra: '',
      alerta: 'Visto perdido ou cancelado — explicação e ano precisam ser confirmados com o cliente.' });
  }
  simNao('negado', 'Have you ever been refused a U.S. Visa, or been refused admission?', 'Já teve visto negado?', d.vistoNegado, 'rblPREV_VISA_REFUSED_IND');
  if (sim(d.vistoNegado)) traduzivel('negadoDet', 'Explain (refusal)', 'Ano, consulado e motivo', d.vistoNegadoDet, 'tbxPREV_VISA_REFUSED_EXPL');
  simNao('peticao', 'Has anyone ever filed an immigrant petition on your behalf?', 'Pedido de imigração?', d.peticaoImigracao, 'rblIV_PETITION_IND');
  if (sim(d.peticaoImigracao)) traduzivel('peticaoDet', 'Explain (petition)', 'Quem pediu e quando', d.peticaoImigracaoDet, 'tbxIV_PETITION_EXPL');

  // ── ADDRESS AND PHONE ───────────────────────────────────────────────────
  S('Address and Phone');
  if (temValor(d.logradouro)) texto('end1', 'Home Address: Street Address (Line 1)', 'Logradouro e número', d.logradouro + (d.numero ? ', ' + d.numero : ''), 'tbxAPP_ADDR_LN1');
  var l2 = [d.complemento, d.bairro].filter(temValor).join(' - ');
  if (l2) texto('end2', 'Street Address (Line 2)', 'Complemento e bairro', l2, 'tbxAPP_ADDR_LN2');
  texto('endCidade', 'City', 'Cidade', d.cidade, 'tbxAPP_ADDR_CITY');
  if (temValor(d.estado)) texto('endEstado', 'State/Province', 'Estado', estadoBR(d.estado), 'tbxAPP_ADDR_STATE');
  if (temValor(d.cep)) texto('endCep', 'Postal Zone/ZIP Code', 'CEP', d.cep, 'tbxAPP_ADDR_POSTAL_CD');
  pais('endPais', 'Country/Region', 'País', 'Brasil', 'ddlCountry');
  if (temValor(d.correspDiferente)) {
    add({ id: 'correspMesmo', r: 'Is your Mailing Address the same as your Home Address?', pt: 'Correspondência em outro endereço? ' + d.correspDiferente,
      mostra: sim(d.correspDiferente) ? 'NO' : 'YES', campos: [radio('rblMailingAddrSame', !sim(d.correspDiferente))] });
    if (sim(d.correspDiferente)) texto('correspEnd', 'Mailing Address', 'Endereço de correspondência', d.correspEndereco, null, { nota: 'Separe rua, cidade, estado e CEP nos campos do site.' });
  }
  if (temValor(d.tel)) add({ id: 'telPrim', r: 'Primary Phone Number', pt: 'Celular', mostra: telefoneBR(d.tel), campos: [{ s: 'tbxAPP_HOME_TEL', t: 'text', v: telefoneBR(d.tel) }] });
  if (temValor(d.tel2)) add({ id: 'telSec', r: 'Secondary Phone Number', pt: 'Telefone secundário', mostra: telefoneBR(d.tel2), campos: [{ s: 'tbxAPP_MOBILE_TEL', t: 'text', v: telefoneBR(d.tel2) }] });
  else naoSeAplica('telSecNA', 'Secondary Phone Number', 'cbexAPP_MOBILE_TEL_NA');
  var telTrab = d.telTrabalho || d.empresaTel;
  if (temValor(telTrab)) add({ id: 'telTrab', r: 'Work Phone Number', pt: 'Telefone do trabalho', mostra: telefoneBR(telTrab), campos: [{ s: 'tbxAPP_BUS_TEL', t: 'text', v: telefoneBR(telTrab) }] });
  else naoSeAplica('telTrabNA', 'Work Phone Number', 'cbexAPP_BUS_TEL_NA');
  var outrosTel = lista(d.outrosTel).filter(function (x) { return digitos(x).length >= 8; });
  add({ id: 'outrosTelInd', r: 'Have you used any other phone numbers in the last five years?', pt: 'Outros telefones (5 anos)',
    mostra: outrosTel.length ? 'YES' : 'NO', campos: [radio('rblAddPhone', outrosTel.length > 0)] });
  outrosTel.slice(0, 5).forEach(function (t, i) {
    add({ id: 'outroTel' + i, r: 'Additional Phone Number ' + (i + 1), pt: 'Outro telefone', mostra: telefoneBR(t),
      campos: [{ s: 'dtlAddPhone_ctl' + pad2(i) + '_tbxAddPhoneInfo', t: 'text', v: telefoneBR(t) }],
      nota: i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : null });
  });
  if (temValor(d.email)) add({ id: 'email', r: 'Email Address', pt: 'E-mail', mostra: String(d.email).trim(), campos: [{ s: 'tbxAPP_EMAIL_ADDR', t: 'text', v: String(d.email).trim() }] });
  var outrosEm = lista(d.outrosEmails).filter(function (x) { return x.indexOf('@') > 0; });
  add({ id: 'outrosEmailInd', r: 'Have you used any other email addresses in the last five years?', pt: 'Outros e-mails (5 anos)',
    mostra: outrosEm.length ? 'YES' : 'NO', campos: [radio('rblAddEmail', outrosEm.length > 0)] });
  outrosEm.slice(0, 5).forEach(function (e, i) {
    add({ id: 'outroEmail' + i, r: 'Additional Email Address ' + (i + 1), pt: 'Outro e-mail', mostra: e,
      campos: [{ s: 'dtlAddEmail_ctl' + pad2(i) + '_tbxAddEmailInfo', t: 'text', v: e }],
      nota: i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : null });
  });
  var REDE = { 'Facebook': ['FCBK', '~FACEBOOK'], 'Instagram': ['INST', '~INSTAGRAM'], 'LinkedIn': ['LINK', '~LINKEDIN'],
    'Pinterest': ['PTST', '~PINTEREST'], 'TikTok': ['~TIKTOK', '~TIK TOK'], 'Twitter / X': ['TWIT', '~TWITTER'], 'YouTube': ['YTUB', '~YOUTUBE'] };
  var redes = (Array.isArray(d.redes) ? d.redes : []).filter(function (r) { return r && temValor(r.usuario); });
  if (!redes.length) add({ id: 'redesNenhuma', r: 'Social Media', pt: 'Redes sociais', mostra: 'NONE',
    campos: [{ s: 'dtlSocial_ctl00_ddlSocialMedia', t: 'select', v: ['NONE', '~NONE'] }], nota: 'Cliente não informou redes sociais — confirme.' });
  redes.slice(0, 8).forEach(function (r, i) {
    var ctl = 'dtlSocial_ctl' + pad2(i) + '_';
    var usuario = String(r.usuario).trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?[^/]+\//i, '').replace(/\/$/, '');
    var c = REDE[r.plataforma];
    add({ id: 'rede' + i, r: 'Social Media ' + (i + 1), pt: (r.plataforma || 'Rede') + ': ' + r.usuario, mostra: (c ? c[c.length - 1].replace('~', '') : up(r.plataforma)) + ' · ' + usuario,
      campos: (c ? [{ s: ctl + 'ddlSocialMedia', t: 'select', v: c }] : []).concat([{ s: ctl + 'tbxSocialMediaIdent', t: 'text', v: usuario }]),
      nota: (c ? '' : 'Plataforma "' + (r.plataforma || '') + '": escolha na lista do site. ') + (i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : '') || null });
  });
  add({ id: 'outrasRedes', r: 'Do you wish to provide information about your presence on any other websites?', pt: '—', mostra: 'NO', campos: [radio('rblAddSocial', false)] });

  // ── PASSPORT ────────────────────────────────────────────────────────────
  S('Passport');
  add({ id: 'pptTipo', r: 'Passport/Travel Document Type', pt: '—', mostra: 'REGULAR', campos: [{ s: 'ddlPPT_TYPE', t: 'select', v: ['R', 'REGULAR'] }] });
  if (temValor(d.passaporte)) add({ id: 'pptNum', r: 'Passport/Travel Document Number', pt: 'Número do passaporte', mostra: up(d.passaporte).replace(/\s/g, ''),
    campos: [{ s: 'tbxPPT_NUM', t: 'text', v: up(d.passaporte).replace(/\s/g, '') }] });
  naoSeAplica('pptLivro', 'Passport Book Number', 'cbexPPT_BOOK_NUM_NA');
  pais('pptPais', 'Country/Authority that Issued Passport', 'País emissor', 'Brasil', 'ddlPPT_ISSUED_CNTRY');
  if (temValor(d.passaporteLocal)) {
    var loc = String(d.passaporteLocal).split(/\s*[\/\-–,]\s*/);
    texto('pptCidade', 'Where was the Passport Issued? City', 'Cidade de emissão', loc[0], 'tbxPPT_ISSUED_IN_CITY');
    if (loc[1]) texto('pptEstado', 'State/Province', 'Estado de emissão', estadoBR(loc[1]), 'tbxPPT_ISSUED_IN_STATE');
  }
  pais('pptPaisEm', 'Country/Region (where issued)', 'País de emissão', 'Brasil', 'ddlPPT_ISSUED_IN_CNTRY');
  data('pptEmissao', 'Issuance Date', 'Data de emissão', d.passaporteEmissao, 'ddlPPT_ISSUED_DTEDay', 'ddlPPT_ISSUED_DTEMonth', 'tbxPPT_ISSUEDYear');
  data('pptValidade', 'Expiration Date', 'Data de validade', d.passaporteVal, 'ddlPPT_EXPIRE_DTEDay', 'ddlPPT_EXPIRE_DTEMonth', 'tbxPPT_EXPIREYear');
  simNao('pptPerdido', 'Have you ever lost a passport or had one stolen?', 'Passaporte perdido/roubado?', d.passaportePerdido, 'rblLOST_PPT_IND');
  if (sim(d.passaportePerdido)) traduzivel('pptPerdidoDet', 'Explain (lost passport)', 'Número, ano e o que aconteceu', d.passaportePerdidoDet, 'dtlLostPPT_ctl00_tbxLOST_PPT_EXPL');

  // ── U.S. CONTACT ────────────────────────────────────────────────────────
  S('U.S. Contact');
  if (sim(d.contatoEUA)) {
    var cn = dividirNome(d.contatoNome);
    add({ id: 'contatoNome', r: 'Contact Person: Surnames / Given Names', pt: 'Contato: ' + (d.contatoNome || ''), mostra: cn.surname + ' / ' + cn.given, origem: d.contatoNome,
      campos: [{ s: 'tbxUS_POC_SURNAME', t: 'text', v: cn.surname }, { s: 'tbxUS_POC_GIVEN_NAME', t: 'text', v: cn.given }],
      nota: 'Se o contato for uma empresa, use o campo Organization Name (↘) e marque "Do Not Know" no nome.' });
    texto('contatoOrg', 'Organization Name', 'Nome da empresa (se for empresa)', d.contatoNome, null, { nota: 'Só se o contato for empresa/hotel.' });
    var cr = relacao(d.contatoParentesco, 'contato');
    add({ id: 'contatoRel', r: 'Relationship to You', pt: 'Relação: ' + (d.contatoParentesco || ''), mostra: cr[0].replace('~', ''), campos: [{ s: 'ddlUS_POC_REL_TO_APP', t: 'select', v: cr }] });
    texto('contatoEnd', 'U.S. Street Address', 'Endereço do contato', d.contatoEndereco, null, { nota: 'Separe rua, cidade, estado e ZIP nos campos do site.' });
    if (temValor(d.contatoTel)) add({ id: 'contatoTel', r: 'Phone Number', pt: 'Telefone do contato', mostra: digitos(d.contatoTel), campos: [{ s: 'tbxUS_POC_HOME_TEL', t: 'text', v: digitos(d.contatoTel) }] });
    if (temValor(d.contatoEmail)) add({ id: 'contatoEmail', r: 'Email Address', pt: 'E-mail do contato', mostra: String(d.contatoEmail).trim(), campos: [{ s: 'tbxUS_POC_EMAIL_ADDR', t: 'text', v: String(d.contatoEmail).trim() }] });
    else naoSeAplica('contatoEmailNA', 'Email Address', 'cbexUS_POC_EMAIL_ADDR_NA');
  } else if (temValor(d.contatoEUA)) {
    add({ id: 'contatoHotel', r: 'U.S. Point of Contact', pt: 'Sem contato nos EUA — usar o hotel', mostra: up(d.hospedagem || ''),
      campos: [check('cbxUS_POC_NAME_NA')],
      nota: 'Marca "Do Not Know" no nome da pessoa. Depois: Organization = nome do hotel, Relationship = OTHER, endereço e telefone do hotel.' });
    add({ id: 'contatoHotelRel', r: 'Relationship to You', pt: '—', mostra: 'OTHER', campos: [{ s: 'ddlUS_POC_REL_TO_APP', t: 'select', v: ['O', 'OTHER'] }] });
  }

  // ── FAMILY: RELATIVES ───────────────────────────────────────────────────
  S('Family: Relatives');
  if (temValor(d.paiNome)) {
    var pai = dividirNome(d.paiNome);
    add({ id: 'paiSob', r: 'Father\'s Surnames', pt: 'Pai: ' + d.paiNome, mostra: pai.surname, campos: [{ s: 'tbxFATHER_SURNAME', t: 'text', v: pai.surname }], nota: 'Confira a divisão sobrenome / nome.' });
    add({ id: 'paiNome', r: 'Father\'s Given Names', pt: 'Pai: ' + d.paiNome, mostra: pai.given, campos: [{ s: 'tbxFATHER_GIVEN_NAME', t: 'text', v: pai.given }] });
    if (parteData(d.paiNasc)) data('paiNasc', 'Father\'s Date of Birth', 'Nascimento do pai', d.paiNasc, 'ddlFathersDOBDay', 'ddlFathersDOBMonth', 'tbxFathersDOBYear');
    else add({ id: 'paiNascNA', r: 'Father\'s Date of Birth', pt: 'Nascimento do pai não informado', mostra: 'DO NOT KNOW', campos: [check('cbxFATHER_DOB_UNK_IND')] });
    simNao('paiEUA', 'Is your father in the U.S.?', 'Pai mora nos EUA?', d.paiEUA || 'Não', 'rblFATHER_LIVE_IN_US_IND');
    if (sim(d.paiEUA)) add({ id: 'paiStatus', r: 'Father\'s Status', pt: d.paiEUAStatus || '', mostra: (statusEUA(d.paiEUAStatus) || [''])[0].replace('~', ''), campos: [{ s: 'ddlFATHER_US_STATUS', t: 'select', v: statusEUA(d.paiEUAStatus) || ['~DON'] }] });
  } else {
    add({ id: 'paiNA', r: 'Father\'s Surnames / Given Names — Do Not Know', pt: 'Pai não consta', mostra: 'DO NOT KNOW',
      campos: [check('cbxFATHER_SURNAME_UNK_IND'), check('cbxFATHER_GIVEN_NAME_UNK_IND')] });
  }
  if (temValor(d.maeNome)) {
    var mae = dividirNome(d.maeNome);
    add({ id: 'maeSob', r: 'Mother\'s Surnames', pt: 'Mãe: ' + d.maeNome, mostra: mae.surname, campos: [{ s: 'tbxMOTHER_SURNAME', t: 'text', v: mae.surname }], nota: 'Confira a divisão sobrenome / nome.' });
    add({ id: 'maeNome', r: 'Mother\'s Given Names', pt: 'Mãe: ' + d.maeNome, mostra: mae.given, campos: [{ s: 'tbxMOTHER_GIVEN_NAME', t: 'text', v: mae.given }] });
    if (parteData(d.maeNasc)) data('maeNasc', 'Mother\'s Date of Birth', 'Nascimento da mãe', d.maeNasc, 'ddlMothersDOBDay', 'ddlMothersDOBMonth', 'tbxMothersDOBYear');
    else add({ id: 'maeNascNA', r: 'Mother\'s Date of Birth', pt: 'Nascimento da mãe não informado', mostra: 'DO NOT KNOW', campos: [check('cbxMOTHER_DOB_UNK_IND')] });
    simNao('maeEUA', 'Is your mother in the U.S.?', 'Mãe mora nos EUA?', d.maeEUA || 'Não', 'rblMOTHER_LIVE_IN_US_IND');
    if (sim(d.maeEUA)) add({ id: 'maeStatus', r: 'Mother\'s Status', pt: d.maeEUAStatus || '', mostra: (statusEUA(d.maeEUAStatus) || [''])[0].replace('~', ''), campos: [{ s: 'ddlMOTHER_US_STATUS', t: 'select', v: statusEUA(d.maeEUAStatus) || ['~DON'] }] });
  }
  simNao('parentesEUA', 'Do you have any immediate relatives, not including parents, in the U.S.?', 'Cônjuge, filhos ou irmãos nos EUA?', d.parentesEUA, 'rblUS_IMMED_RELATIVE_IND');
  if (sim(d.parentesEUA)) {
    (Array.isArray(d.parentes) ? d.parentes : []).slice(0, 8).forEach(function (p, i) {
      if (!p || !temValor(p.nome)) return;
      var n = dividirNome(p.nome), ctl = 'dlUSRelatives_ctl' + pad2(i) + '_';
      var tipo = relacao(p.parentesco, 'parente');
      var st = statusEUA(p.status);
      var campos = [{ s: ctl + 'tbxUS_REL_SURNAME', t: 'text', v: n.surname }, { s: ctl + 'tbxUS_REL_GIVEN_NAME', t: 'text', v: n.given }];
      if (tipo) campos.push({ s: ctl + 'ddlUS_REL_TYPE', t: 'select', v: tipo });
      if (st) campos.push({ s: ctl + 'ddlUS_REL_STATUS', t: 'select', v: st });
      add({ id: 'parente' + i, r: 'Relative in the U.S. ' + (i + 1), pt: p.nome + ' · ' + (p.parentesco || '') + ' · ' + (p.status || ''),
        mostra: n.surname + ' / ' + n.given + (tipo ? ' · ' + tipo[0].replace('~', '') : ''), origem: p.status, campos: campos,
        nota: (tipo ? '' : 'Pais e parentes distantes não entram aqui (pais vão acima; tios/primos só na pergunta "other relatives"). ') + 'Confira a divisão sobrenome / nome.' });
    });
  }
  simNao('outrosParentes', 'Do you have any other relatives in the U.S.?', 'Tios, primos… nos EUA?', d.outrosParentesEUA, 'rblUS_OTHER_RELATIVE_IND');

  // ── FAMILY: SPOUSE / FORMER SPOUSE ──────────────────────────────────────
  S('Family: Spouse');
  if (temValor(d.conjugeNome)) {
    var cj = dividirNome(d.conjugeNome);
    add({ id: 'cjSob', r: 'Spouse\'s Surnames', pt: 'Cônjuge: ' + d.conjugeNome, mostra: cj.surname, campos: [{ s: 'tbxSpouseSurname', t: 'text', v: cj.surname }], nota: 'Confira a divisão sobrenome / nome.' });
    add({ id: 'cjNome', r: 'Spouse\'s Given Names', pt: 'Cônjuge: ' + d.conjugeNome, mostra: cj.given, campos: [{ s: 'tbxSpouseGivenName', t: 'text', v: cj.given }] });
    data('cjNasc', 'Spouse\'s Date of Birth', 'Nascimento do cônjuge', d.conjugeNasc, 'ddlDOBDay', 'ddlDOBMonth', 'tbxDOBYear');
    pais('cjNac', 'Spouse\'s Nationality', 'Nacionalidade do cônjuge', d.conjugeNacionalidade || 'Brasil', 'ddlSpouseNatDropDownList');
    texto('cjCidade', 'Spouse\'s Place of Birth: City', 'Cidade de nascimento', d.conjugeCidadeNasc, 'tbxSpousePOBCity');
    naoSeAplica('cjEstadoNA', 'Spouse\'s Place of Birth: State — Does Not Apply', 'cbxSpousePOBStateProvinceNA', 'Opcional: se preferir, digite o estado de nascimento.');
    pais('cjPais', 'Spouse\'s Place of Birth: Country', 'País de nascimento', d.conjugePaisNasc || 'Brasil', 'ddlSpousePOBCountry');
    if (temValor(d.conjugeMesmoEndereco)) {
      var mesmo = !sim(d.conjugeMesmoEndereco) ? false : true;
      add({ id: 'cjEnd', r: 'Spouse\'s Address', pt: 'Mora no mesmo endereço? ' + d.conjugeMesmoEndereco,
        mostra: mesmo ? 'SAME AS HOME ADDRESS' : 'OTHER (SPECIFY ADDRESS)',
        campos: [{ s: 'ddlSpouseAddressType', t: 'select', v: mesmo ? ['H', '~SAME AS HOME'] : ['O', '~OTHER'] }] });
      if (!mesmo) texto('cjEndereco', 'Spouse\'s Address (specify)', 'Endereço do cônjuge', d.conjugeEndereco, null, { nota: 'Separe rua, cidade, estado e CEP nos campos do site.' });
    }
  }
  if (temValor(d.exNome)) {
    var ex = dividirNome(d.exNome);
    var viuvo = d.estadoCivil === 'Viúvo(a)';
    var pre = viuvo ? '' : 'DListSpouse_ctl00_';
    if (!viuvo) add({ id: 'exQtd', r: 'Number of Former Spouses', pt: 'Ex-cônjuges', mostra: '1', campos: [{ s: 'tbxNumberOfPrevSpouses', t: 'text', v: '1' }],
      nota: 'Se houver mais de um ex-cônjuge, ajuste no site.' });
    add({ id: 'exSob', r: (viuvo ? 'Deceased' : 'Former') + ' Spouse\'s Surnames', pt: 'Ex-cônjuge: ' + d.exNome, mostra: ex.surname,
      campos: [{ s: pre + 'tbxSURNAME', t: 'text', v: ex.surname }], nota: 'Confira a divisão sobrenome / nome.' });
    add({ id: 'exNome', r: (viuvo ? 'Deceased' : 'Former') + ' Spouse\'s Given Names', pt: 'Ex-cônjuge: ' + d.exNome, mostra: ex.given,
      campos: [{ s: pre + 'tbxGIVEN_NAME', t: 'text', v: ex.given }] });
    data('exNasc', 'Date of Birth', 'Nascimento do ex-cônjuge', d.exNasc, pre + 'ddlDOBDay', pre + 'ddlDOBMonth', pre + 'tbxDOBYear');
    pais('exNac', 'Nationality', 'Nacionalidade do ex-cônjuge', d.exNacionalidade || 'Brasil', pre + 'ddlSpouseNatDropDownList');
    texto('exCidade', 'Place of Birth: City', 'Cidade de nascimento', d.exCidadeNasc, pre + 'tbxSpousePOBCity');
    pais('exPais', 'Place of Birth: Country', 'País de nascimento', d.exPaisNasc || 'Brasil', pre + 'ddlSpousePOBCountry');
    if (!viuvo) {
      data('exCasou', 'Date of Marriage', 'Data do casamento', d.exCasamento, pre + 'ddlDomDay', pre + 'ddlDomMonth', pre + 'txtDomYear');
      data('exFim', 'Date Marriage Ended', 'Data do divórcio', d.exFim, pre + 'ddlDomEndDay', pre + 'ddlDomEndMonth', pre + 'txtDomEndYear');
      traduzivel('exComo', 'How the Marriage Ended', 'Como terminou', d.exMotivo || 'Divórcio', pre + 'tbxHowMarriageEnded');
      pais('exPaisDiv', 'Country/Region Marriage was Terminated', 'País do divórcio', d.exPaisDivorcio || 'Brasil', pre + 'ddlMarriageEnded_CNTRY');
    }
  }

  // ── WORK / EDUCATION: PRESENT ───────────────────────────────────────────
  S('Work / Education: Present');
  if (temValor(d.ocupacao)) {
    var OC = { 'Aposentado(a)': ['RT', 'RETIRED'], 'Do lar': ['H', 'HOMEMAKER'], 'Estudante': ['S', 'STUDENT'],
      'Sem ocupação no momento': ['N', 'NOT EMPLOYED'], 'Servidor(a) público(a)': ['G', 'GOVERNMENT'], 'Empresário(a)': ['B', 'BUSINESS'] };
    var oc = OC[d.ocupacao];
    add({ id: 'ocupacao', r: 'Primary Occupation', pt: 'Ocupação: ' + d.ocupacao + (d.ocupacaoOutra ? ' (' + d.ocupacaoOutra + ')' : ''),
      mostra: oc ? oc[1] : '', campos: oc ? [{ s: 'ddlPresentOccupation', t: 'select', v: oc }] : undefined,
      nota: oc ? (d.ocupacao === 'Empresário(a)' ? 'BUSINESS é o padrão para empresário — troque se a área for outra (ex.: COMPUTER SCIENCE, MEDICAL/HEALTH).' : null)
        : 'Escolha a área no site (ex.: BUSINESS, COMPUTER SCIENCE, EDUCATION, ENGINEERING, LEGAL PROFESSION, MEDICAL/HEALTH). Cargo: ' + (d.cargo || '—') });
    if (d.ocupacao === 'Aposentado(a)' || d.ocupacao === 'Sem ocupação no momento' || d.ocupacao === 'Outro') {
      var expl = d.ocupacao === 'Aposentado(a)' ? 'Aposentado(a)' + (d.ocupacaoAnterior ? '. Última profissão: ' + d.ocupacaoAnterior : '') + (d.rendaAposentadoria ? '. Renda mensal aproximada: R$ ' + d.rendaAposentadoria : '')
        : d.ocupacao === 'Outro' ? (d.ocupacaoOutra || '') : 'Sem ocupação no momento';
      traduzivel('ocupExpl', 'Explain', 'Explicação da ocupação', expl, 'tbxExplainOtherInfo');
    }
  }
  if (temValor(d.empresaNome)) {
    texto('empNome', 'Present Employer or School Name', 'Empresa / instituição', d.empresaNome, 'tbxEmpSchName');
    texto('empEnd', 'Street Address (Line 1)', 'Endereço do trabalho', d.empresaEndereco, 'tbxEmpSchAddr1');
    texto('empCidade', 'City', 'Cidade do trabalho', d.empresaCidade, 'tbxEmpSchCity');
    if (temValor(d.empresaEstado)) texto('empEstado', 'State/Province', 'Estado do trabalho', estadoBR(d.empresaEstado), 'tbxWORK_EDUC_ADDR_STATE');
    if (temValor(d.empresaCep)) texto('empCep', 'Postal Zone/ZIP Code', 'CEP do trabalho', d.empresaCep, 'tbxWORK_EDUC_ADDR_POSTAL_CD');
    else naoSeAplica('empCepNA', 'Postal Zone/ZIP Code', 'cbxWORK_EDUC_ADDR_POSTAL_CD_NA');
    if (temValor(d.empresaTel)) add({ id: 'empTel', r: 'Phone Number', pt: 'Telefone do trabalho', mostra: telefoneBR(d.empresaTel), campos: [{ s: 'tbxWORK_EDUC_TEL', t: 'text', v: telefoneBR(d.empresaTel) }] });
    pais('empPais', 'Country/Region', 'País', 'Brasil', 'ddlEmpSchCountry');
    data('empInicio', 'Start Date', 'Início no trabalho atual', d.empresaInicio, 'ddlEmpDateFromDay', 'ddlEmpDateFromMonth', 'tbxEmpDateFromYear');
    if (temValor(d.renda)) {
      var renda = digitos(String(d.renda).replace(/[,.]\d{2}$/, ''));
      add({ id: 'renda', r: 'Monthly Income in Local Currency', pt: 'Renda mensal (R$)', mostra: renda, origem: d.renda, campos: [{ s: 'tbxCURR_MONTHLY_SALARY', t: 'text', v: renda }] });
    }
    traduzivel('funcoes', 'Briefly describe your duties', 'O que você faz' + (d.cargo ? ' (cargo: ' + d.cargo + ')' : ''), (d.cargo ? d.cargo + '. ' : '') + (d.funcoes || ''), 'tbxDescribeDuties');
  }

  // ── WORK / EDUCATION: PREVIOUS ──────────────────────────────────────────
  S('Work / Education: Previous');
  simNao('empAnt', 'Were you previously employed?', 'Outros empregos nos últimos 5 anos?', d.empregosAnteriores, 'rblPreviouslyEmployed');
  if (sim(d.empregosAnteriores)) {
    (Array.isArray(d.anteriores) ? d.anteriores : []).slice(0, 5).forEach(function (e, i) {
      if (!e || !temValor(e.empresa)) return;
      var ctl = 'dtlPrevEmpl_ctl' + pad2(i) + '_';
      var sup = dividirNome(e.supervisor);
      var campos = [
        { s: ctl + 'tbEmployerName', t: 'text', v: up(e.empresa) },
        { s: ctl + 'tbEmployerStreetAddress1', t: 'text', v: up(e.endereco) },
        { s: ctl + 'DropDownList2', t: 'select', v: ['BRZL', 'BRAZIL'] },
        { s: ctl + 'tbJobTitle', t: 'text', v: up(e.cargo) }
      ];
      if (temValor(e.telefone)) campos.push({ s: ctl + 'tbEmployerPhone', t: 'text', v: telefoneBR(e.telefone) });
      if (temValor(e.supervisor)) campos.push({ s: ctl + 'tbSupervisorSurname', t: 'text', v: sup.surname }, { s: ctl + 'tbSupervisorGivenName', t: 'text', v: sup.given });
      else campos.push(check(ctl + 'cbxSupervisorSurname_NA'), check(ctl + 'cbxSupervisorGivenName_NA'));
      campos = campos.concat(camposData(ctl + 'ddlEmpDateFromDay', ctl + 'ddlEmpDateFromMonth', ctl + 'tbxEmpDateFromYear', e.inicio));
      campos = campos.concat(camposData(ctl + 'ddlEmpDateToDay', ctl + 'ddlEmpDateToMonth', ctl + 'tbxEmpDateToYear', e.fim));
      add({ id: 'empAnt' + i, r: 'Previous Employer ' + (i + 1), pt: e.empresa + ' · ' + (e.cargo || '') + ' · ' + fmtData(e.inicio) + ' a ' + fmtData(e.fim),
        mostra: up(e.empresa) + ' · ' + up(e.cargo), campos: campos,
        nota: 'Cidade, estado e CEP ficam para completar (endereço veio junto: "' + (e.endereco || '') + '").' + (i > 0 ? ' Se a linha não existir, clique em "Add Another" no site.' : '') });
      if (temValor(e.funcoes)) traduzivel('empAntFun' + i, 'Previous Employer ' + (i + 1) + ': Briefly describe your duties', 'O que fazia', e.funcoes, ctl + 'tbDescribeDuties');
    });
  }
  var inst = (Array.isArray(d.instituicoes) ? d.instituicoes : []).filter(function (x) { return x && temValor(x.nome); });
  if (temValor(d.escolaridade)) add({ id: 'estudou', r: 'Have you attended any educational institutions at a secondary level or above?', pt: 'Escolaridade: ' + d.escolaridade,
    mostra: d.escolaridade === 'Ensino fundamental' ? 'NO' : 'YES', campos: [radio('rblOtherEduc', d.escolaridade !== 'Ensino fundamental')] });
  inst.slice(0, 6).forEach(function (x, i) {
    var ctl = 'dtlPrevEduc_ctl' + pad2(i) + '_';
    var cidUf = String(x.cidade || '').split(/\s*[\/\-–,]\s*/);
    var campos = [{ s: ctl + 'tbxSchoolName', t: 'text', v: up(x.nome) }];
    if (temValor(x.endereco)) campos.push({ s: ctl + 'tbxSchoolAddr1', t: 'text', v: up(x.endereco) });
    if (cidUf[0]) campos.push({ s: ctl + 'tbxSchoolCity', t: 'text', v: up(cidUf[0]) });
    if (cidUf[1]) campos.push({ s: ctl + 'tbxEDUC_INST_ADDR_STATE', t: 'text', v: estadoBR(cidUf[1]) });
    campos.push(check(ctl + 'cbxEDUC_INST_POSTAL_CD_NA'));
    campos.push({ s: ctl + 'ddlSchoolCountry', t: 'select', v: ['BRZL', 'BRAZIL'] });
    campos = campos.concat(camposData(ctl + 'ddlSchoolFromDay', ctl + 'ddlSchoolFromMonth', ctl + 'tbxSchoolFromYear', x.inicio));
    campos = campos.concat(camposData(ctl + 'ddlSchoolToDay', ctl + 'ddlSchoolToMonth', ctl + 'tbxSchoolToYear', x.fim));
    add({ id: 'inst' + i, r: 'Educational Institution ' + (i + 1), pt: x.nome + ' · ' + (x.curso || '') + ' · ' + (x.cidade || ''),
      mostra: up(x.nome), campos: campos,
      nota: (temValor(x.endereco) ? '' : 'Endereço da instituição não informado — complete no site. ') + (i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : '') || null });
    if (temValor(x.curso)) traduzivel('instCurso' + i, 'Institution ' + (i + 1) + ': Course of Study', 'Curso', x.curso, ctl + 'tbxSchoolCourseOfStudy');
  });

  // ── WORK / EDUCATION: ADDITIONAL ────────────────────────────────────────
  S('Work / Education: Additional');
  add({ id: 'cla', r: 'Do you belong to a clan or tribe?', pt: '—', mostra: 'NO', campos: [radio('rblCLAN_TRIBE_IND', false)] });
  lista(d.idiomas || 'Português').slice(0, 6).forEach(function (l, i) {
    var en = idiomaDs(l);
    add({ id: 'idioma' + i, r: 'Language ' + (i + 1), pt: 'Idioma: ' + l, mostra: en || up(l),
      campos: [{ s: 'dtlLANGUAGES_ctl' + pad2(i) + '_tbxLANGUAGE_NAME', t: 'text', v: en || null }], tr: en ? undefined : l,
      nota: i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : null });
  });
  var paises = lista(d.paisesVisitados).filter(function (p) { return !/^(nenhum|nao|não)$/i.test(p); });
  add({ id: 'paisesInd', r: 'Have you traveled to any countries/regions within the last five years?', pt: 'Países visitados (5 anos)',
    mostra: paises.length ? 'YES' : 'NO', campos: [radio('rblCOUNTRIES_VISITED_IND', paises.length > 0)] });
  paises.slice(0, 15).forEach(function (p, i) {
    var c = candidatosPais(p);
    add({ id: 'paisVis' + i, r: 'Country/Region ' + (i + 1), pt: 'País visitado: ' + p, mostra: c ? c[c.length - 1].replace('~', '') : up(p),
      campos: c ? [{ s: 'dtlCountriesVisited_ctl' + pad2(i) + '_ddlCOUNTRIES_VISITED', t: 'select', v: c }] : undefined,
      nota: (c ? '' : 'País não reconhecido — escolha na lista do site. ') + (i > 0 ? 'Se a linha não existir, clique em "Add Another" no site.' : '') || null });
  });
  simNao('org', 'Have you belonged to, contributed to, or worked for any professional, social, or charitable organization?', 'Organizações?', d.organizacoes, 'rblORGANIZATION_IND');
  if (sim(d.organizacoes)) lista(d.organizacoesQuais).slice(0, 5).forEach(function (o, i) {
    traduzivel('orgNome' + i, 'Organization Name ' + (i + 1), 'Organização', o, 'dtlORGANIZATIONS_ctl' + pad2(i) + '_tbxORGANIZATION_NAME');
  });
  simNao('habil', 'Do you have any specialized skills or training (firearms, explosives, nuclear, biological, chemical)?', 'Conhecimento em armas/explosivos?', d.habilidades, 'rblSPECIALIZED_SKILLS_IND');
  if (sim(d.habilidades)) traduzivel('habilDet', 'Explain (skills)', 'Descreva', d.habilidadesDet, 'tbxSPECIALIZED_SKILLS_EXPL');
  simNao('militar', 'Have you ever served in the military?', 'Serviu às Forças Armadas?', d.militar, 'rblMILITARY_SERVICE_IND');
  if (sim(d.militar)) {
    var mc = 'dtlMILITARY_SERVICE_ctl00_';
    pais('milPais', 'Military: Country/Region', 'País', d.militarPais || 'Brasil', mc + 'ddlMILITARY_SVC_CNTRY');
    traduzivel('milForca', 'Branch of Service', 'Força', d.militarForca, mc + 'tbxMILITARY_SVC_BRANCH');
    traduzivel('milPatente', 'Rank/Position', 'Patente', d.militarPatente, mc + 'tbxMILITARY_SVC_RANK');
    traduzivel('milEsp', 'Military Specialty', 'Especialidade', d.militarEspecialidade, mc + 'tbxMILITARY_SVC_SPECIALTY');
    data('milIni', 'Date of Service From', 'Início', d.militarInicio, mc + 'ddlMILITARY_SVC_FROMDay', mc + 'ddlMILITARY_SVC_FROMMonth', mc + 'tbxMILITARY_SVC_FROMYear');
    data('milFim', 'Date of Service To', 'Fim', d.militarFim, mc + 'ddlMILITARY_SVC_TODay', mc + 'ddlMILITARY_SVC_TOMonth', mc + 'tbxMILITARY_SVC_TOYear');
  }
  add({ id: 'insurgente', r: 'Have you ever served in, been a member of, or been involved with a paramilitary unit, vigilante unit, rebel group, guerrilla group, or insurgent organization?',
    pt: '—', mostra: 'NO', campos: [radio('rblINSURGENT_ORG_IND', false)] });
  add({ id: 'taliban', r: 'Taliban', pt: '—', mostra: 'NO', campos: [radio('rblTALIBAN_IND', false)] });

  // ── SECURITY AND BACKGROUND ─────────────────────────────────────────────
  S('Security and Background');
  if (d.seguranca === 'Não') {
    var GRUPOS = [
      ['Part 1 — saúde', ['rblDisease', 'rblDisorder', 'rblDruguser']],
      ['Part 2 — crimes', ['rblArrested', 'rblControlledSubstances', 'rblProstitution', 'rblMoneyLaundering', 'rblHumanTrafficking', 'rblAssistedSevereTrafficking', 'rblHumanTraffickingRelated']],
      ['Part 3 — segurança', ['rblIllegalActivity', 'rblTerroristActivity', 'rblTerroristSupport', 'rblTerroristOrg', 'rblTerroristRel', 'rblGenocide', 'rblTorture', 'rblExViolence', 'rblChildSoldier', 'rblReligiousFreedom', 'rblPopulationControls', 'rblTransplant']],
      ['Part 4 — imigração', ['rblImmigrationFraud', 'rblFailToAttend', 'rblVisaViolation', 'rblRemovalHearing', 'rblDeport']],
      ['Part 5 — outros', ['rblChildCustody', 'rblVotingViolation', 'rblRenounceExp', 'rblAttWoReimb', 'rblSchoolViolation']]
    ];
    GRUPOS.forEach(function (g, i) {
      add({ id: 'seg' + (i + 1), r: 'Security and Background ' + g[0] + ': todas as perguntas', pt: 'Nenhuma situação se aplica', mostra: 'NO (todas)',
        campos: g[1].map(function (s) { return radio(s, false); }), opcional: true });
    });
  } else if (sim(d.seguranca)) {
    add({ id: 'segAlerta', r: 'Security and Background', pt: 'Alguma situação se aplica', mostra: '',
      alerta: 'Cliente marcou que alguma situação se aplica: responder manualmente. Relato: ' + (d.segurancaDet || '—') });
  }

  // "não sei" em qualquer resposta do cliente vira alerta do item.
  return itens;
}

// Todos os sufixos citados (para o content script sondar a página).
function sufixos(itens) {
  var set = {};
  itens.forEach(function (it) { (it.campos || []).forEach(function (c) { set[c.s] = 1; }); });
  return Object.keys(set);
}

var api = { SECOES: SECOES, montarItens: montarItens, sufixos: sufixos, semAcento: semAcento, up: up };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else raiz.DS160Mapa = api;
})(this);
