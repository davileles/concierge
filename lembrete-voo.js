/**
 * lembrete-voo.js — Clube do Viajante
 * Roda via GitHub Action a cada hora.
 *
 * Cada modelo define:
 *   modo: 'manual' | 'programado'
 *   gatilho: qual campo de data usar como referência
 *     'voo_ida_dt'         → dataIda + horaPartida (por reserva)
 *     'voo_ida_d'          → dataIda (00:00) (por reserva)
 *     'voo_volta_dt'       → dataVolta + horaPartidaVolta (por reserva)
 *     'voo_volta_d'        → dataVolta (00:00) (por reserva)
 *     'checkin'            → checkin do hotel (14:00)
 *     'seguro_inicio'      → seguroInicio da reserva de seguro (por reserva)
 *     'seguro_fim'         → seguroFim da reserva de seguro (por reserva)
 *     'viagem'             → dataInicio da viagem (00:00)
 *     'primeiro_voo_viagem'→ data+hora do primeiro voo da viagem (por viagem)
 *   antecedencia: { valor: N, unidade: 'dias' | 'horas' }
 *
 * Modelos com modo 'manual' (ou sem modo) são ignorados.
 * Múltiplos modelos podem apontar para o mesmo gatilho com antecedências diferentes.
 *
 * Além dos modelos, o script dispara um alerta INTERNO de check-in online:
 * 26h antes de cada perna (ida e volta) de toda reserva tipo 'voo', avisando
 * no grupo de alertas (cfg.grupoAlertas) que aquela reserva precisa de
 * check-in. Não depende de modelo cadastrado e não vai para o cliente.
 */

const fs   = require('fs');
const path = require('path');

const BAILEYS      = 'https://baileys-server-production-ebfe.up.railway.app';
const PROXY        = 'https://cdv-proxy-production.up.railway.app';
const GITHUB_TOKEN = process.env.CDV_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO         = 'davileles/concierge';
const API_BASE     = `https://api.github.com/repos/${REPO}/contents`;
const TZ_SP        = 'America/Sao_Paulo';

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ── fuso horário por aeroporto ───────────────────────────────────────────────
// Os horários gravados na reserva são SEMPRE horário local do aeroporto de
// partida. Antes o cálculo assumia -03:00 fixo, o que atrasava/adiantava todo
// disparo de voo que não partia do Brasil (ex: DUS 13:00 CEST era tratado como
// 13:00 BRT → alerta 5h atrasado). Agora resolvemos o instante real via
// Intl.DateTimeFormat, que no Node 20 já traz o tzdata completo — sem
// dependência nova e sem novo arquivo de dados.
const IATA_TZ = {
  // ── Brasil (exceções ao fuso de Brasília) ──
  MAO:'America/Manaus', PVH:'America/Porto_Velho', BVB:'America/Boa_Vista',
  RBR:'America/Rio_Branco', CZS:'America/Rio_Branco',
  CGB:'America/Cuiaba', CGR:'America/Campo_Grande',
  FEN:'America/Noronha',
  // ── Brasil (Brasília) ──
  GRU:'America/Sao_Paulo', CGH:'America/Sao_Paulo', VCP:'America/Sao_Paulo',
  GIG:'America/Sao_Paulo', SDU:'America/Sao_Paulo', CNF:'America/Sao_Paulo',
  PLU:'America/Sao_Paulo', BSB:'America/Sao_Paulo', CWB:'America/Sao_Paulo',
  POA:'America/Sao_Paulo', FLN:'America/Sao_Paulo', NVT:'America/Sao_Paulo',
  IGU:'America/Sao_Paulo', GYN:'America/Sao_Paulo', SSA:'America/Sao_Paulo',
  REC:'America/Sao_Paulo', FOR:'America/Sao_Paulo', NAT:'America/Sao_Paulo',
  MCZ:'America/Sao_Paulo', AJU:'America/Sao_Paulo', JPA:'America/Sao_Paulo',
  THE:'America/Sao_Paulo', SLZ:'America/Sao_Paulo', BEL:'America/Sao_Paulo',
  MCP:'America/Sao_Paulo', PMW:'America/Sao_Paulo', VIX:'America/Sao_Paulo',
  IOS:'America/Sao_Paulo', UNA:'America/Sao_Paulo', BPS:'America/Sao_Paulo',
  JOI:'America/Sao_Paulo', LDB:'America/Sao_Paulo', MGF:'America/Sao_Paulo',
  RAO:'America/Sao_Paulo', SJP:'America/Sao_Paulo', UDI:'America/Sao_Paulo',
  // ── Europa ocidental / central (CET/CEST) ──
  LIS:'Europe/Lisbon', OPO:'Europe/Lisbon', FAO:'Europe/Lisbon',
  MAD:'Europe/Madrid', BCN:'Europe/Madrid', AGP:'Europe/Madrid',
  SVQ:'Europe/Madrid', VLC:'Europe/Madrid', PMI:'Europe/Madrid',
  CDG:'Europe/Paris', ORY:'Europe/Paris', BVA:'Europe/Paris',
  NCE:'Europe/Paris', LYS:'Europe/Paris', MRS:'Europe/Paris',
  AMS:'Europe/Amsterdam', BRU:'Europe/Brussels', LUX:'Europe/Luxembourg',
  FRA:'Europe/Berlin', MUC:'Europe/Berlin', DUS:'Europe/Berlin',
  BER:'Europe/Berlin', HAM:'Europe/Berlin', STR:'Europe/Berlin',
  CGN:'Europe/Berlin', HAJ:'Europe/Berlin', NUE:'Europe/Berlin',
  ZRH:'Europe/Zurich', GVA:'Europe/Zurich', BSL:'Europe/Zurich',
  VIE:'Europe/Vienna', SZG:'Europe/Vienna', INN:'Europe/Vienna',
  PRG:'Europe/Prague', BUD:'Europe/Budapest', WAW:'Europe/Warsaw',
  KRK:'Europe/Warsaw', CPH:'Europe/Copenhagen', ARN:'Europe/Stockholm',
  OSL:'Europe/Oslo', ZAG:'Europe/Zagreb', SPU:'Europe/Zagreb',
  DBV:'Europe/Zagreb', LJU:'Europe/Ljubljana', TIA:'Europe/Tirane',
  // ── Itália ──
  FCO:'Europe/Rome', CIA:'Europe/Rome', MXP:'Europe/Rome', LIN:'Europe/Rome',
  BGY:'Europe/Rome', VCE:'Europe/Rome', TSF:'Europe/Rome', NAP:'Europe/Rome',
  FLR:'Europe/Rome', PSA:'Europe/Rome', TRN:'Europe/Rome', BLQ:'Europe/Rome',
  BRI:'Europe/Rome', CTA:'Europe/Rome', PMO:'Europe/Rome', AHO:'Europe/Rome',
  OLB:'Europe/Rome', CAG:'Europe/Rome', VRN:'Europe/Rome', GOA:'Europe/Rome',
  // ── Reino Unido / Irlanda / Norte ──
  LHR:'Europe/London', LGW:'Europe/London', STN:'Europe/London',
  LTN:'Europe/London', LCY:'Europe/London', MAN:'Europe/London',
  EDI:'Europe/London', BHX:'Europe/London', GLA:'Europe/London',
  DUB:'Europe/Dublin', KEF:'Atlantic/Reykjavik',
  // ── Europa oriental / mediterrâneo ──
  ATH:'Europe/Athens', JTR:'Europe/Athens', JMK:'Europe/Athens',
  HER:'Europe/Athens', RHO:'Europe/Athens', CFU:'Europe/Athens',
  HEL:'Europe/Helsinki', RIX:'Europe/Riga', TLL:'Europe/Tallinn',
  VNO:'Europe/Vilnius', OTP:'Europe/Bucharest', SOF:'Europe/Sofia',
  BEG:'Europe/Belgrade', IST:'Europe/Istanbul', SAW:'Europe/Istanbul',
  AYT:'Europe/Istanbul', MLA:'Europe/Malta',
  // ── Atlântico / África / Oriente Médio ──
  LPA:'Atlantic/Canary', TFS:'Atlantic/Canary', TFN:'Atlantic/Canary',
  FNC:'Atlantic/Madeira', PDL:'Atlantic/Azores', SID:'Atlantic/Cape_Verde',
  CMN:'Africa/Casablanca', RAK:'Africa/Casablanca', CAI:'Africa/Cairo',
  JNB:'Africa/Johannesburg', CPT:'Africa/Johannesburg', NBO:'Africa/Nairobi',
  DXB:'Asia/Dubai', AUH:'Asia/Dubai', DOH:'Asia/Qatar', TLV:'Asia/Jerusalem',
  RUH:'Asia/Riyadh', JED:'Asia/Riyadh', AMM:'Asia/Amman',
  // ── Ásia / Oceania ──
  NRT:'Asia/Tokyo', HND:'Asia/Tokyo', KIX:'Asia/Tokyo', ICN:'Asia/Seoul',
  PEK:'Asia/Shanghai', PKX:'Asia/Shanghai', PVG:'Asia/Shanghai',
  CAN:'Asia/Shanghai', HKG:'Asia/Hong_Kong', TPE:'Asia/Taipei',
  SIN:'Asia/Singapore', BKK:'Asia/Bangkok', HKT:'Asia/Bangkok',
  KUL:'Asia/Kuala_Lumpur', CGK:'Asia/Jakarta', DPS:'Asia/Makassar',
  DEL:'Asia/Kolkata', BOM:'Asia/Kolkata', MLE:'Indian/Maldives',
  SYD:'Australia/Sydney', MEL:'Australia/Melbourne', BNE:'Australia/Brisbane',
  PER:'Australia/Perth', AKL:'Pacific/Auckland',
  // ── América do Norte ──
  JFK:'America/New_York', LGA:'America/New_York', EWR:'America/New_York',
  BOS:'America/New_York', IAD:'America/New_York', DCA:'America/New_York',
  BWI:'America/New_York', PHL:'America/New_York', ATL:'America/New_York',
  MIA:'America/New_York', FLL:'America/New_York', MCO:'America/New_York',
  TPA:'America/New_York', RSW:'America/New_York', CLT:'America/New_York',
  DTW:'America/New_York', ORD:'America/Chicago', MDW:'America/Chicago',
  IAH:'America/Chicago', HOU:'America/Chicago', DFW:'America/Chicago',
  AUS:'America/Chicago', MSY:'America/Chicago', MSP:'America/Chicago',
  DEN:'America/Denver', PHX:'America/Phoenix', SLC:'America/Denver',
  LAX:'America/Los_Angeles', SFO:'America/Los_Angeles',
  SAN:'America/Los_Angeles', SEA:'America/Los_Angeles',
  LAS:'America/Los_Angeles', PDX:'America/Los_Angeles',
  HNL:'Pacific/Honolulu', ANC:'America/Anchorage',
  YYZ:'America/Toronto', YUL:'America/Toronto', YOW:'America/Toronto',
  YVR:'America/Vancouver', YYC:'America/Edmonton',
  // ── América Latina / Caribe ──
  MEX:'America/Mexico_City', CUN:'America/Cancun', GDL:'America/Mexico_City',
  SJD:'America/Mazatlan', PTY:'America/Panama', SJO:'America/Costa_Rica',
  HAV:'America/Havana', PUJ:'America/Santo_Domingo',
  SDQ:'America/Santo_Domingo', SJU:'America/Puerto_Rico',
  AUA:'America/Aruba', CUR:'America/Curacao', BON:'America/Kralendijk',
  BGI:'America/Barbados', NAS:'America/Nassau', MBJ:'America/Jamaica',
  EZE:'America/Argentina/Buenos_Aires', AEP:'America/Argentina/Buenos_Aires',
  BRC:'America/Argentina/Salta', MDZ:'America/Argentina/Mendoza',
  USH:'America/Argentina/Ushuaia', COR:'America/Argentina/Cordoba',
  SCL:'America/Santiago', IPC:'Pacific/Easter',
  MVD:'America/Montevideo', PDP:'America/Montevideo',
  ASU:'America/Asuncion', VVI:'America/La_Paz', LPB:'America/La_Paz',
  BOG:'America/Bogota', CTG:'America/Bogota', MDE:'America/Bogota',
  LIM:'America/Lima', CUZ:'America/Lima', UIO:'America/Guayaquil',
  GPS:'Pacific/Galapagos', CCS:'America/Caracas'
};

// Fuso de um valor de origem/destino. Aceita código IATA; qualquer outra coisa
// (nome de cidade de hotel, campo vazio) cai no fuso de São Paulo.
function tzDe(valor) {
  const v = String(valor || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) return TZ_SP;
  return IATA_TZ[v] || TZ_SP;
}

// Deslocamento (ms) do fuso em relação ao UTC no instante informado.
function tzOffsetMs(tz, utcMs) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(new Date(utcMs))) p[type] = value;
    let h = Number(p.hour);
    if (h === 24) h = 0;
    const comoUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                             h, Number(p.minute), Number(p.second));
    return comoUTC - utcMs;
  } catch (e) {
    console.warn(`[tz] fuso inválido "${tz}": ${e.message} — assumindo -03:00`);
    return -3 * 3_600_000;
  }
}

// Converte data+hora LOCAL do aeroporto em timestamp UTC.
// Duas passadas resolvem a virada de horário de verão (o offset depende do
// próprio instante que estamos calculando).
function instanteLocal(dataISO, horario, tz) {
  const [y, m, d]  = String(dataISO).split('-').map(Number);
  const [hh, mm]   = String(horario || '00:00').split(':').map(Number);
  const alvo = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  let ts = alvo - tzOffsetMs(tz, alvo);
  ts = alvo - tzOffsetMs(tz, ts);
  return ts;
}

// horasAte(data, hora, local) — `local` é o código IATA de PARTIDA do trecho.
// Omitido, mantém o comportamento antigo (fuso de São Paulo).
function horasAte(dataISO, horario, local) {
  if (!dataISO) return Infinity;
  const ts = instanteLocal(dataISO, horario, tzDe(local));
  return (ts - Date.now()) / 3_600_000;
}

function antecedenciaEmHoras(ant) {
  if (!ant || !ant.valor) return 48;
  return ant.unidade === 'horas' ? Number(ant.valor) : Number(ant.valor) * 24;
}

// A Action deveria rodar de hora em hora, mas o agendador do GitHub Actions
// já apresentou gaps reais de até ~4h12min entre execuções (cron scheduling
// não é garantido). Margem ampliada de 3h para 6h para não perder disparos
// quando a Action atrasa além do esperado.
function deveDisparar(horasRestantes, janela) {
  return horasRestantes >= 0 && horasRestantes <= janela && horasRestantes > (janela - 6);
}

// Gatilhos que usam a hora já registrada na reserva
const GATILHOS_COM_HORA = new Set(['voo_ida_dt', 'voo_volta_dt', 'primeiro_voo_viagem']);

// Resolve data+hora alvo. horaRef é o horário de referência configurado no modelo
// para gatilhos sem hora fixa (ex: '10:00').
function resolverDataHora(gatilho, horaRef, res, viagem) {
  const ref = horaRef || '10:00';
  switch (gatilho) {
    // `local`: aeroporto/cidade cujo fuso rege a hora informada. Sem valor,
    // horasAte() cai em America/Sao_Paulo (comportamento antigo).
    case 'voo_ida_dt':   return { data: res?.dataIda,       hora: res?.horaPartida      || '00:00', tipo: 'voo',    local: res?.origem };
    case 'voo_ida_d':    return { data: res?.dataIda,       hora: ref,                              tipo: 'voo',    local: res?.origem };
    case 'voo_volta_dt': return { data: res?.dataVolta,     hora: res?.horaPartidaVolta || '00:00', tipo: 'voo',    local: res?.origemVolta || res?.destino };
    case 'voo_volta_d':  return { data: res?.dataVolta,     hora: ref,                              tipo: 'voo',    local: res?.origemVolta || res?.destino };
    case 'checkin':      return { data: res?.checkin,       hora: ref,                              tipo: 'hotel',  local: res?.destino };
    case 'seguro_inicio':return { data: res?.seguroInicio,  hora: ref,                              tipo: 'seguro', local: null };
    case 'seguro_fim':   return { data: res?.seguroFim,     hora: ref,                              tipo: 'seguro', local: null };
    case 'viagem':       return { data: viagem?.dataInicio, hora: ref,                              tipo: 'viagem', local: null };
    default:             return { data: null, hora: '00:00', tipo: null, local: null };
  }
}

// ── primeiro voo de uma viagem ────────────────────────────────────────────────
// Retorna { data, hora, reserva } do primeiro voo vinculado à viagem,
// ou null se não houver voos vinculados.
function resolverPrimeiroVoo(viagem, reservasMap) {
  if (!Array.isArray(viagem.atividades)) return null;

  const voosIds = viagem.atividades
    .filter(a => a.reservaId)
    .map(a => a.reservaId);

  let melhor = null;

  for (const rid of voosIds) {
    const res = reservasMap[rid];
    if (!res || res.tipo !== 'voo' || !res.dataIda) continue;
    const horaPartida = res.horaPartida || '00:00';
    if (!melhor) {
      melhor = { data: res.dataIda, hora: horaPartida, origem: res.origem, reserva: res };
      continue;
    }
    // Comparar instantes reais (cada voo no fuso do seu aeroporto de partida)
    const dtAtual  = instanteLocal(res.dataIda, horaPartida, tzDe(res.origem));
    const dtMelhor = instanteLocal(melhor.data, melhor.hora, tzDe(melhor.origem));
    if (dtAtual < dtMelhor) {
      melhor = { data: res.dataIda, hora: horaPartida, origem: res.origem, reserva: res };
    }
  }

  return melhor;
}

// ── base IATA ─────────────────────────────────────────────────────────────────
// Reaproveita o iata.js já existente no repo (5.700 aeroportos, formato
// "CODE|Cidade – Aeroporto (País)"). O workflow faz actions/checkout, então o
// arquivo está disponível no runner — sem dependência externa e sem novo JSON.

// A base bruta traz o município real e nomes em inglês. Overrides corrigem as
// cidades comerciais e a grafia PT-BR dos destinos mais usados.
const IATA_OVERRIDE = {
  // Brasil
  GIG:'Rio de Janeiro', SDU:'Rio de Janeiro', VCP:'Campinas',
  // Itália
  MXP:'Milão', LIN:'Milão', BGY:'Milão', FCO:'Roma', CIA:'Roma',
  VCE:'Veneza', TSF:'Veneza', NAP:'Nápoles', FLR:'Florença', PSA:'Pisa',
  TRN:'Turim', BLQ:'Bolonha',
  // Península Ibérica
  LIS:'Lisboa', OPO:'Porto', MAD:'Madri', BCN:'Barcelona', AGP:'Málaga',
  SVQ:'Sevilha', VLC:'Valência', FAO:'Faro',
  // França / Benelux
  CDG:'Paris', ORY:'Paris', BVA:'Paris', NCE:'Nice', LYS:'Lyon',
  MRS:'Marselha', AMS:'Amsterdã', BRU:'Bruxelas',
  // Reino Unido / Irlanda
  LHR:'Londres', LGW:'Londres', STN:'Londres', LTN:'Londres', LCY:'Londres',
  MAN:'Manchester', EDI:'Edimburgo', DUB:'Dublin',
  // Europa central e norte
  FRA:'Frankfurt', MUC:'Munique', BER:'Berlim', DUS:'Düsseldorf',
  ZRH:'Zurique', GVA:'Genebra', VIE:'Viena', PRG:'Praga', BUD:'Budapeste',
  WAW:'Varsóvia', CPH:'Copenhague', ARN:'Estocolmo', OSL:'Oslo',
  HEL:'Helsinque', ATH:'Atenas', IST:'Istambul', SAW:'Istambul',
  // Américas
  JFK:'Nova York', LGA:'Nova York', EWR:'Nova York',
  LAX:'Los Angeles', ORD:'Chicago', MDW:'Chicago', MIA:'Miami',
  MCO:'Orlando', ATL:'Atlanta', IAH:'Houston', DFW:'Dallas',
  SFO:'São Francisco', LAS:'Las Vegas', BOS:'Boston', SEA:'Seattle',
  YYZ:'Toronto', YUL:'Montreal', YVR:'Vancouver',
  MEX:'Cidade do México', CUN:'Cancún', PTY:'Cidade do Panamá',
  EZE:'Buenos Aires', AEP:'Buenos Aires', SCL:'Santiago',
  MVD:'Montevidéu', BOG:'Bogotá', LIM:'Lima', UIO:'Quito',
  // Ásia / Oriente Médio / África / Oceania
  DXB:'Dubai', AUH:'Abu Dhabi', DOH:'Doha', TLV:'Tel Aviv',
  NRT:'Tóquio', HND:'Tóquio', ICN:'Seul', PEK:'Pequim', PVG:'Xangai',
  HKG:'Hong Kong', SIN:'Singapura', BKK:'Bangcoc', DEL:'Nova Délhi',
  BOM:'Mumbai', JNB:'Joanesburgo', CPT:'Cidade do Cabo', CAI:'Cairo',
  SYD:'Sydney', MEL:'Melbourne', AKL:'Auckland'
};

const IATA_CIDADE = (() => {
  const mapa = {};
  try {
    const src = fs.readFileSync(path.join(__dirname, 'iata.js'), 'utf-8');
    const re  = /"([A-Z]{3})\|([^"]+)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      // label: "Cidade – Aeroporto (País)" — corta no primeiro en-dash.
      // ~286 entradas (aeródromos remotos) não têm cidade: cai no nome do aeroporto.
      const partes = m[2].split('\u2013');
      const limpar = s => (s || '').replace(/\(.*?\)/g, '').trim();
      const nome   = limpar(partes[0]) || limpar(partes.slice(1).join('\u2013'));
      if (nome) mapa[m[1]] = nome;
    }
    console.log(`[iata] ${Object.keys(mapa).length} aeroportos carregados`);
  } catch (e) {
    console.warn(`[iata] falha ao carregar iata.js: ${e.message} — mantendo código IATA`);
  }
  return Object.assign(mapa, IATA_OVERRIDE);
})();

// "CNF" → "Belo Horizonte (CNF)".
// Valores que não são código de 3 letras (ex: cidade de hotel) voltam intactos.
// Código não encontrado na base volta como o próprio código.
function localDe(valor) {
  const v = String(valor || '').trim();
  if (!/^[A-Za-z]{3}$/.test(v)) return v;
  const code   = v.toUpperCase();
  const cidade = IATA_CIDADE[code];
  return cidade ? `${cidade} (${code})` : code;
}

// ── economia gerada ───────────────────────────────────────────────────────────
// Premissa: quanto vale, em R$, cada 1.000 pontos/milhas de cada programa.
// Espelha VALORES_PONTOS_PADRAO do index.html; cfg.valoresPontos sobrescreve.
const VALORES_PONTOS_PADRAO = {
  'AAdvantage':      100,
  'Azul Fidelidade':  13,
  'Esfera':           30,
  'Executive Club':   60.90,
  'Finnair Plus':     60.90,
  'Iberia Plus':      60.90,
  'LATAM Pass':       26,
  'Livelo':           30,
  'Privilege Club':   60.90,
  'Smiles':           16,
  'SUMA':             80
};
let CFG_PONTOS = {}; // preenchido no main() a partir de cfg.json

function parseValorBR(v) {
  let s = String(v == null ? '' : v).replace(/[^\d,.]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const partes = s.split('.');
    if (partes.length > 2) s = partes.join('');
    else if (partes.length === 2 && partes[1].length === 3) s = partes.join('');
  }
  return parseFloat(s) || 0;
}

function valorMilheiro(programa) {
  if (!programa) return 0;
  let v = CFG_PONTOS[programa];
  if (v === undefined || v === null || v === '') v = VALORES_PONTOS_PADRAO[programa];
  if (v === undefined || v === null || v === '') return 0;
  return parseValorBR(v) || 0;
}

const fmtBRL    = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPontos = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');

function calcularEconomia(r) {
  const vazio = { valor: 0, modo: null, detalhe: '' };
  if (!r) return vazio;
  const isLoc = (r.tipo === 'carro' && r.subtipo === 'locacao');
  if (r.tipo !== 'voo' && r.tipo !== 'hotel' && r.tipo !== 'seguro' && !isLoc) return vazio;
  const te = r.tipoEmissao || '';

  if (te === 'milhas') {
    let prog, pontos, ref;
    if (r.tipo === 'voo') {
      prog   = r.programa || '';
      pontos = parseValorBR(r.milhasTotal) || (parseValorBR(r.milhas) * (parseInt(r.pax, 10) || 1));
      const tar = parseValorBR(r.valor);
      ref = (r.tarifaBase === 'total') ? tar : tar * (parseInt(r.pax, 10) || 1);
    } else {
      prog   = r.programaMilhas || '';
      pontos = parseValorBR(r.valorMilhas);
      ref    = parseValorBR(r.valorTarifaPagante);
    }
    const vm = valorMilheiro(prog);
    if (!ref || !pontos || !vm) return vazio;
    const custo = pontos / 1000 * vm;
    return { valor: ref - custo, modo: 'resgate',
      detalhe: `Tarifa pagante R$ ${fmtBRL(ref)} − ${fmtPontos(pontos)} ${prog} a R$ ${fmtBRL(vm)}/mil (R$ ${fmtBRL(custo)})` };
  }

  if (te === 'balcao' && r.tipo === 'voo') {
    const tarB   = parseValorBR(r.valor);
    const refB   = (r.tarifaBase === 'total') ? tarB : tarB * (parseInt(r.paxBalcao, 10) || 1);
    const custoB = parseValorBR(r.valorTotalBalcao);
    if (!refB || !custoB) return vazio;
    return { valor: refB - custoB, modo: 'balcao',
      detalhe: `Tarifa pagante R$ ${fmtBRL(refB)} − valor desembolsado R$ ${fmtBRL(custoB)}` };
  }

  if (te === 'dinheiro_acumulo') {
    const progA = (r.tipo === 'voo') ? (r.programaAcumuloVoo || '') : (r.programaAcumulo || '');
    const ptsA  = parseValorBR(r.milhasAcumulo);
    const vmA   = valorMilheiro(progA);
    if (!ptsA || !vmA) return vazio;
    return { valor: ptsA / 1000 * vmA, modo: 'acumulo',
      detalhe: `${fmtPontos(ptsA)} ${progA} acumulados a R$ ${fmtBRL(vmA)}/mil` };
  }

  return vazio;
}

// ── interpolação ──────────────────────────────────────────────────────────────
function interpolar(texto, cli, res, viagem, viagens) {
  const rv = (t, key, val) => t.split(`{{${key}}}`).join(val || '');
  let t = texto;
  if (cli) {
    t = rv(t, 'nome',           cli.nome || '');
    t = rv(t, 'primeiro_nome',  (cli.nome || '').split(' ')[0]);
    t = rv(t, 'telefone',       cli.tel   || '');
    t = rv(t, 'email',          cli.email || '');
    t = rv(t, 'cpf',            cli.cpf   || '');
    t = rv(t, 'cidade',         cli.cidade || '');
  }
  if (res) {
    t = rv(t, 'origem',              localDe(res.origem));
    t = rv(t, 'destino',             localDe(res.destino));
    t = rv(t, 'data_ida',            fmtDateBR(res.dataIda));
    t = rv(t, 'data_chegada_ida',    fmtDateBR(res.dataChegadaIda));
    t = rv(t, 'hora_partida',        res.horaPartida       || '');
    t = rv(t, 'hora_chegada',        res.horaChegada       || '');
    t = rv(t, 'nvoo_ida',            res.nvooIda           || '');
    t = rv(t, 'cia',                 res.ciaIda || res.cia || '');
    t = rv(t, 'data_volta',          fmtDateBR(res.dataVolta));
    t = rv(t, 'data_chegada_volta',  fmtDateBR(res.dataChegadaVolta));
    t = rv(t, 'hora_partida_volta',  res.horaPartidaVolta  || '');
    t = rv(t, 'hora_chegada_volta',  res.horaChegadaVolta  || '');
    t = rv(t, 'nvoo_volta',          res.nvooVolta         || '');
    t = rv(t, 'cia_volta',           res.ciaVolta          || '');
    t = rv(t, 'origem_volta',        localDe(res.origemVolta  || res.destino));
    t = rv(t, 'destino_volta',       localDe(res.destinoVolta || res.origem));
    t = rv(t, 'classe',              res.classe   || '');
    t = rv(t, 'pnr',                 res.pnr      || '');
    t = rv(t, 'programa',            res.programa || '');
    t = rv(t, 'milhas',              res.milhas   || '');
    t = rv(t, 'pax',                 res.pax      || '');
    t = rv(t, 'passageiros',         nomesPassageiros(res).join(', '));
    t = rv(t, 'hotel',               res.hotelNome || '');
    t = rv(t, 'checkin',             fmtDateBR(res.checkin));
    t = rv(t, 'checkout',            fmtDateBR(res.checkout));
    t = rv(t, 'noites',              res.noites   || '');
    t = rv(t, 'conf',                res.conf     || '');
    // ── Seguro viagem ──
    const _seg = res.tipo === 'seguro';
    const _modLbl = { anual: 'Anual', multiviagem: 'Multiviagem', unica: 'Viagem unica' }[res.seguroModalidade] || (res.seguroModalidade || '');
    t = rv(t, 'seguradora',           _seg ? (res.seguradora || '') : '');
    t = rv(t, 'seguro_plano',         _seg ? (res.seguroPlano || '') : '');
    t = rv(t, 'seguro_apolice',       _seg ? (res.conf || '') : '');
    t = rv(t, 'seguro_cartao',        _seg ? (res.seguroCartao || '') : '');
    t = rv(t, 'seguro_inicio',        _seg ? fmtDateBR(res.seguroInicio) : '');
    t = rv(t, 'seguro_fim',           _seg ? fmtDateBR(res.seguroFim) : '');
    t = rv(t, 'seguro_modalidade',    _seg ? _modLbl : '');
    t = rv(t, 'seguro_dias',          _seg ? (res.seguroDias || '') : '');
    t = rv(t, 'seguro_territorio',    _seg ? (res.seguroTerritorio || '') : '');
    t = rv(t, 'seguro_cobertura',     _seg ? (res.seguroCobertura || '') : '');
    t = rv(t, 'seguro_pax',           _seg ? (res.pax || '') : '');
    t = rv(t, 'seguro_emergencia',    _seg ? (res.seguroEmergencia || '') : '');
    t = rv(t, 'seguro_valor',         _seg ? (res.valorDinheiro || '') : '');
    t = rv(t, 'seguro_acumulo_valor', _seg ? (res.valorAcumulo || '') : '');
    t = rv(t, 'seguro_milhas',        _seg ? (res.valorMilhas || '') : '');
    t = rv(t, 'seguro_valor_tarifa',  _seg ? (res.valorTarifaPagante || res.valorAcumulo || '') : '');
    t = rv(t, 'acumulo_programa',     res.programaAcumulo || res.programaAcumuloVoo || '');
    t = rv(t, 'acumulo_milhas',       res.milhasAcumulo || '');
    t = rv(t, 'acumulo_parceiro',     res.parceiroAcumulo || '');
    const _eco = calcularEconomia(res);
    t = rv(t, 'economia',         _eco.valor > 0 ? fmtBRL(_eco.valor) : (res.economiaGerada  || ''));
    t = rv(t, 'economia_detalhe', _eco.valor > 0 ? _eco.detalhe       : (res.economiaDetalhe || ''));
  }
  // nome_viagem: viagem do contexto do gatilho ou, para gatilhos de reserva,
  // a viagem que contém a reserva entre suas atividades
  const viagemAssoc = viagem || ((viagens || []).find(v =>
    (v.atividades || []).some(a => a.reservaId === res?.id)
  ) || null);
  t = rv(t, 'nome_viagem', viagemAssoc ? (viagemAssoc.nome || viagemAssoc.destino || '') : '');
  if (viagem) {
    t = rv(t, 'viagem_nome',         viagem.nome        || '');
    t = rv(t, 'viagem_destino',      viagem.destino     || '');
    t = rv(t, 'viagem_data_inicio',  fmtDateBR(viagem.dataInicio || viagem.inicio));
    t = rv(t, 'viagem_data_fim',     fmtDateBR(viagem.dataFim    || viagem.fim));
    t = rv(t, 'viagem_pax',          viagem.pax         || '');
  }
  return t;
}

// ── GitHub API ────────────────────────────────────────────────────────────────
async function githubGet(path) {
  const r = await fetch(`${API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`GitHub GET ${path} → ${r.status}`);
  const d = await r.json();
  const content = Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  return { data: JSON.parse(content), sha: d.sha };
}

async function githubPut(path, data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const r = await fetch(`${API_BASE}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, content, sha })
  });
  if (!r.ok) throw new Error(`GitHub PUT ${path} → ${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

// ── clientes via proxy CDV ────────────────────────────────────────────────────
// Antes lia o Apps Script direto, e com dois bugs: `r.json()` devolve
// { ok, rows } — `rows.slice(1)` num objeto lancava TypeError, engolido pelo
// .catch do Promise.all — e `ci()` so olhava a PRIMEIRA letra da coluna, entao
// colunas de duas letras (colSenhas 'AE', colGrupo 'BN') apontavam para o lugar
// errado. Na pratica o loop rodava sem base de clientes, sustentado pelo
// fallback grupoPorCliente montado a partir das reservas.
// Agora le o JSON versionado em cdv-tsp-dados/concierge/clientes.json.
async function carregarClientes() {
  const r = await fetch(`${PROXY}/concierge/clientes`);
  if (!r.ok) throw new Error(`proxy /concierge/clientes → ${r.status}`);
  const d = await r.json();
  if (!d.ok) throw new Error(d.erro || 'proxy respondeu ok=false');
  return (d.data || [])
    .map(c => ({
      nome:   String(c.nome   || '').trim(),
      tel:    String(c.tel    || '').trim(),
      email:  String(c.email  || '').trim(),
      cpf:    String(c.cpf    || '').trim(),
      cidade: String(c.cidade || '').trim(),
      grupo:  String(c.grupo  || '').trim(),
      ativo:  c.ativo === true,
    }))
    .filter(c => c.nome);
}

// ── envio ─────────────────────────────────────────────────────────────────────
// Numero de disparo do concierge (Configuracao -> "Numero que dispara as
// mensagens", gravado em cfg.json). Vazio = conta principal do Baileys, que era
// o comportamento antes deste campo existir. Precisa ser modulo-global: o
// enviarWhatsApp e chamado de meia duzia de lugares, e passar o apelido por
// parametro em todos eles so criaria oportunidade de esquecer um.
let CONTA_ENVIO = '';

async function enviarWhatsApp(grupoId, mensagem) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let r;
  try {
    r = await fetch(`${BAILEYS}/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grupo: grupoId, mensagem, conta: CONTA_ENVIO }),
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(`Falha de rede ao chamar Baileys: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
  const bodyText = await r.text();
  let d;
  try { d = JSON.parse(bodyText); }
  catch { throw new Error(`Baileys retornou HTTP ${r.status} com corpo não-JSON: ${bodyText.slice(0,200)}`); }
  if (!d.ok) throw new Error(`${d.erro || 'Falha no envio'} (HTTP ${r.status})`);
}

// Chave única por modelo para evitar reenvio (flag legada, dentro de reservas.json)
function flagKey(modeloId) { return `enviado_${modeloId}`; }

// ── ledger de envios (msgs-enviadas.json) ────────────────────────────────────
// Fonte primária de deduplicação. Vive em arquivo próprio, que o painel NUNCA
// escreve — diferente das flags `enviado_*` gravadas dentro de reservas.json,
// que o painel apagava sem querer ao salvar seu array em memória (padrão
// read-modify-write), fazendo a mesma mensagem ser reenviada na execução
// seguinte enquanto a janela de disparo continuava aberta.
//
// Formato: { "MOD-xxx|RES-yyy": "2026-07-25T23:01:53.106Z" }
// O formato legado (array de strings) continua sendo lido sem quebrar.
const LEDGER_FILE  = 'msgs-enviadas.json';
const LEDGER_RETER = 180; // dias — depois disso o voo já passou; reenvio é impossível

let ledger    = {};
let ledgerSha = null;

function ledgerKey(modeloId, alvoId) { return `${modeloId}|${alvoId}`; }

async function carregarLedger() {
  try {
    const { data, sha } = await githubGet(LEDGER_FILE);
    ledgerSha = sha;
    if (Array.isArray(data))                     for (const k of data) ledger[k] = null;
    else if (data && typeof data === 'object')   ledger = data;
  } catch (e) {
    console.warn(`[ledger] ${LEDGER_FILE} indisponível (${e.message}) — começando vazio`);
  }
  console.log(`[ledger] ${Object.keys(ledger).length} envio(s) já registrado(s)`);
}

// Grava o ledger IMEDIATAMENTE após cada envio bem-sucedido. Se a Action morrer
// no meio (timeout, erro fatal, falha de rede), tudo que já saiu está
// registrado — gravar só no fim deixaria janela aberta para reenvio.
async function registrarEnvio(modeloId, alvoId) {
  if (!alvoId) return false;
  const k = ledgerKey(modeloId, alvoId);
  ledger[k] = new Date().toISOString();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await githubPut(LEDGER_FILE, ledger, ledgerSha, `chore: envio registrado — ${k}`);
      ledgerSha = (r && r.content && r.content.sha) || null;
      return true;
    } catch (e) {
      // 409 = escrita concorrente venceu a corrida: recarrega, reaplica o que
      // temos em memória por cima e tenta de novo com SHA fresco.
      if (/409/.test(e.message) && tentativa < 2) {
        try {
          const { data, sha } = await githubGet(LEDGER_FILE);
          ledgerSha = sha;
          if (data && !Array.isArray(data)) ledger = Object.assign({}, data, ledger);
        } catch (_) { /* mantém estado local e tenta assim mesmo */ }
        continue;
      }
      console.error(`⚠️ [ledger] falha ao registrar ${k}: ${e.message}`);
      return false;
    }
  }
  return false;
}

// Entradas antigas são descartadas em memória; a limpeza persiste junto do
// próximo envio registrado — não vale um PUT só para podar.
function podarLedger() {
  const corte = Date.now() - LEDGER_RETER * 86400000;
  let removidos = 0;
  for (const [k, ts] of Object.entries(ledger)) {
    if (ts && new Date(ts).getTime() < corte) { delete ledger[k]; removidos++; }
  }
  if (removidos) console.log(`[ledger] ${removidos} registro(s) com mais de ${LEDGER_RETER} dias descartados`);
}

// Já enviado? Ledger é a fonte primária; a flag legada dentro de
// reservas.json/viagens.json continua valendo para o que foi enviado antes
// desta mudança.
function jaEnviado(modeloId, alvo) {
  if (alvo && alvo.id && ledger[ledgerKey(modeloId, alvo.id)]) return true;
  return !!(alvo && alvo[flagKey(modeloId)]);
}

// ── log de diagnóstico ──────────────────────────────────────────────────────
// Registrado a cada execução em debug-log.json, independente de ter havido
// envio ou não. Objetivo: dar visibilidade real sobre por que um lembrete
// disparou ou não, sem depender dos logs nativos da Action.
const debugLog = [];
function logDebug(entry) {
  debugLog.push({ ...entry, ts: new Date().toISOString() });
}

// ── alerta interno: check-in online do voo ───────────────────────────────────
// Independe de modelos.json: vale para toda reserva tipo 'voo'. Vai para o grupo
// interno de alertas (cfg.grupoAlertas), NÃO para o grupo do cliente.
// Janela 24h→20h: o teto coincide com a abertura do check-in (24h antes da
// partida), para o atendente já poder agir ao receber o alerta e garantir boa
// escolha de assentos. O piso de 20h é só rede de segurança se as execuções
// atrasarem. Não usa deveDisparar() (margem fixa de 6h dos modelos) — a margem
// aqui é própria (CHECKIN_MARGEM_H).
// Atenção: o gatilho 'checkin' dos modelos é check-in de HOTEL. Este é outro.
const CHECKIN_JANELA_H = 24;
const CHECKIN_MARGEM_H = 4;

// Resolve a perna do voo. Campos de volta caem para os da ida quando vazios
// (reserva antiga preenchia só origem/destino).
function trechoCheckin(res, perna) {
  if (perna === 'ida') {
    if (!res.dataIda) return null;
    return {
      rotulo: 'Ida',
      data:   res.dataIda,
      hora:   res.horaPartida || '00:00',
      origem: res.origem,
      destino: res.destino,
      cia:    res.ciaIda,
      nvoo:   res.nvooIda
    };
  }
  if (!res.dataVolta) return null;
  return {
    rotulo: 'Volta',
    data:   res.dataVolta,
    hora:   res.horaPartidaVolta || '00:00',
    origem: res.origemVolta  || res.destino,
    destino: res.destinoVolta || res.origem,
    cia:    res.ciaVolta || res.ciaIda,
    nvoo:   res.nvooVolta
  };
}

// Nomes dos passageiros exatamente como foram emitidos (extraidos do bilhete
// anexado na criacao da reserva). Aceita array de strings ou de objetos {nome}.
// A grafia nunca e normalizada: e ela que o check-in exige.
function nomesPassageiros(res) {
  const arr = res && res.passageiros;
  if (!Array.isArray(arr)) return [];
  return arr
    .map(p => (typeof p === 'string' ? p : ((p && (p.nome || p.name)) || '')))
    .map(n => String(n).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function msgCheckinVoo(res, t, horas) {
  const l = ['🛫 *Check-in liberado — ação necessária*', ''];
  l.push(`*Cliente:* ${res.cliente || '—'}`);
  const voo = [t.nvoo, t.cia].filter(Boolean).join(' · ');
  if (voo) l.push(`*Voo:* ${voo} (${t.rotulo})`);
  l.push(`*Trecho:* ${localDe(t.origem)} → ${localDe(t.destino)}`);
  l.push(`*Partida:* ${fmtDateBR(t.data)}${(t.hora && t.hora !== '00:00') ? ' às ' + t.hora : ''} (em ${Math.round(horas)}h)`);
  if (res.pnr)    l.push(`*Localizador:* ${res.pnr}`);
  if (res.classe) l.push(`*Classe:* ${res.classe}`);
  if (res.pax)    l.push(`*Pax:* ${res.pax}`);
  const _nomes = nomesPassageiros(res);
  if (_nomes.length) {
    l.push('', '*Passageiros — grafia da emissão:*');
    _nomes.forEach(n => l.push(`• ${n}`));
  }
  l.push('', 'Fazer o check-in online desta reserva.');
  return l.join('\n');
}

// Dedup pelo mesmo ledger dos modelos, com IDs sintéticos que não colidem com
// os MOD-xxx: CHECKIN24-IDA|RES-xxx e CHECKIN24-VOLTA|RES-xxx.
async function alertarCheckinVoo(reservas, grupoAlertas, resultados) {
  if (!grupoAlertas) {
    console.log('\n[check-in voo] grupoAlertas não configurado em cfg.json — bloco ignorado.');
    logDebug({ bloco: 'checkin_voo', erro: 'grupoAlertas não configurado em cfg.json' });
    return 0;
  }
  console.log(`\n[check-in voo] janela=${CHECKIN_JANELA_H}h → grupo ${grupoAlertas}`);
  let enviados = 0;
  for (const res of reservas) {
    if (res.tipo !== 'voo') continue;
    for (const perna of ['ida', 'volta']) {
      const modId = `CHECKIN24-${perna.toUpperCase()}`;
      if (jaEnviado(modId, res)) continue;
      const t = trechoCheckin(res, perna);
      if (!t) continue;

      // t.origem é o aeroporto de partida da perna → define o fuso da hora.
      const horas = horasAte(t.data, t.hora, t.origem);
      const disparar = horas >= 0 && horas <= CHECKIN_JANELA_H && horas > (CHECKIN_JANELA_H - CHECKIN_MARGEM_H);
      if (horas >= 0 && horas <= CHECKIN_JANELA_H + 6) {
        console.log(`  "${res.cliente}" ${perna} ${t.data} ${t.hora} → ${horas.toFixed(1)}h`);
        logDebug({ bloco: 'checkin_voo', perna, reservaId: res.id, cliente: res.cliente, horasRestantes: Number(horas.toFixed(2)), janela: CHECKIN_JANELA_H, disparar });
      }
      if (!disparar) continue;

      try {
        await enviarWhatsApp(grupoAlertas, msgCheckinVoo(res, t, horas));
        await registrarEnvio(modId, res.id);
        enviados++;
        resultados.push(`✅ [check-in ${perna}] "${res.cliente}" — ${t.origem}→${t.destino} ${t.data}`);
        logDebug({ bloco: 'checkin_voo', perna, reservaId: res.id, cliente: res.cliente, grupo: grupoAlertas, tentativa: 'sucesso' });
      } catch (e) {
        resultados.push(`❌ [check-in ${perna}] "${res.cliente}": ${e.message}`);
        console.error('  ❌', e.message);
        logDebug({ bloco: 'checkin_voo', perna, reservaId: res.id, cliente: res.cliente, grupo: grupoAlertas, tentativa: 'erro', erro: e.message });
      }
    }
  }
  return enviados;
}

// ── migração de modelos antigos ───────────────────────────────────────────────
const MIGRAR_GATILHO = {
  lembrete_ida:     'voo_ida_dt',
  lembrete_volta:   'voo_volta_dt',
  lembrete_checkin: 'checkin',
  lembrete_viagem:  'viagem',
  voo_ida:          'voo_ida_dt',
  voo_volta:        'voo_volta_dt',
};

function normalizarModelo(m) {
  // Modelos criados antes do campo modo/gatilho novo
  if (!m.modo) {
    const gatilhoMigrado = MIGRAR_GATILHO[m.gatilho] || MIGRAR_GATILHO[m.tipo];
    m.modo    = gatilhoMigrado ? 'programado' : 'manual';
    m.gatilho = gatilhoMigrado || m.gatilho || '';
  }
  return m;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[lembrete] Iniciando — ${new Date().toLocaleString('pt-BR', { timeZone: TZ_SP })}`);

  if (!GITHUB_TOKEN) { console.error('❌ CDV_GITHUB_TOKEN não definido'); process.exit(1); }

  const [reservasResp, modelosResp, viagensResp, clientes, , cfgResp] = await Promise.all([
    githubGet('reservas.json'),
    githubGet('modelos.json'),
    githubGet('viagens.json').catch(() => ({ data: [], sha: null })),
    carregarClientes().catch(e => { console.warn('[clientes]', e.message); return []; }),
    carregarLedger(),
    githubGet('cfg.json').catch(() => ({ data: {}, sha: null }))
  ]);
  podarLedger();

  const reservas = reservasResp.data;
  const modelos  = modelosResp.data.map(normalizarModelo);
  const viagens  = Array.isArray(viagensResp.data)
    ? viagensResp.data
    : (viagensResp.data?.items || []);
  // Grupo interno de alertas — mesma fonte usada pelo proxy (cfg.grupoAlertas).
  const grupoAlertas = (cfgResp.data && cfgResp.data.grupoAlertas) || '';
  // Premissas de valor dos pontos (Configuração → Valor dos Pontos) para {{economia}}
  CFG_PONTOS = (cfgResp.data && cfgResp.data.valoresPontos) || {};
  // Número que dispara: mesma conta usada pelos envios manuais do painel.
  CONTA_ENVIO = String((cfgResp.data && cfgResp.data.contaEnvio) || '').trim();
  if (CONTA_ENVIO) console.log(`[envio] Disparando pela conta "${CONTA_ENVIO}".`);

  // Mapa de reservas por ID (para lookup eficiente no gatilho primeiro_voo_viagem)
  const reservasMap = {};
  for (const res of reservas) {
    if (res.id) reservasMap[res.id] = res;
  }

  // Fallback de grupo WhatsApp por cliente: cada reserva já salva o grupo
  // (coluna BN da planilha) no momento do cadastro. Usamos isso quando o
  // lookup via Apps Script falhar (nome divergente, coluna vazia, etc).
  const grupoPorCliente = {};
  for (const res of reservas) {
    if (res.cliente && res.grupo && !grupoPorCliente[res.cliente]) {
      grupoPorCliente[res.cliente] = res.grupo;
    }
  }

  const ativos = modelos.filter(m => m.modo === 'programado' && m.gatilho && m.antecedencia);

  // Sem modelo programado o loop abaixo simplesmente não roda — mas o alerta de
  // check-in não depende de modelos, então a execução continua.
  if (!ativos.length) {
    console.log('[lembrete] Nenhum modelo programado cadastrado.');
  } else {
    console.log(`[lembrete] ${ativos.length} modelo(s) programado(s) | ${reservas.length} reservas | ${clientes.length} clientes`);
    ativos.forEach(m => {
      const ant = `${m.antecedencia.valor} ${m.antecedencia.unidade}`;
      console.log(`  • "${m.nome}" → ${m.gatilho} · ${ant} antes`);
    });
  }

  let totalAlteracoes = 0;
  const resultados = [];

  for (const mod of ativos) {
    const janela = antecedenciaEmHoras(mod.antecedencia);

    console.log(`\n[${mod.nome}] gatilho=${mod.gatilho} janela=${janela}h`);

    // ── Gatilho: primeiro voo da viagem ────────────────────────────────────
    if (mod.gatilho === 'primeiro_voo_viagem') {
      for (const viagem of viagens) {
        if (jaEnviado(mod.id, viagem)) continue; // já enviado para esta viagem

        const primeiroVoo = resolverPrimeiroVoo(viagem, reservasMap);
        if (!primeiroVoo) {
          console.log(`  "${viagem.nome}" — sem voos vinculados, ignorando`);
          continue;
        }

        const horas = horasAte(primeiroVoo.data, primeiroVoo.hora, primeiroVoo.origem);
        console.log(`  "${viagem.nome}" → primeiro voo ${primeiroVoo.data} ${primeiroVoo.hora} → ${horas.toFixed(1)}h`);
        const disparar = deveDisparar(horas, janela);
        logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, horasRestantes: Number(horas.toFixed(2)), janela, disparar });
        if (!disparar) continue;

        const clientesViagem = Array.isArray(viagem.clientes)
          ? viagem.clientes
          : (viagem.clientes ? [viagem.clientes] : []);

        let algum = false;
        for (const nomeCliente of clientesViagem) {
          const cli   = clientes.find(c => c.nome === nomeCliente);
          const grupo = cli?.grupo || primeiroVoo.reserva?.grupo || grupoPorCliente[nomeCliente];
          if (!grupo) {
            console.log(`  ⚠️ Cliente "${nomeCliente}" sem grupo WhatsApp (Apps Script nem reservas)`);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nomeCliente, erro: 'sem grupo WhatsApp' });
            continue;
          }
          try {
            // Interpola com contexto da viagem + dados do primeiro voo
            const msg = interpolar(mod.texto, cli || { nome: nomeCliente }, primeiroVoo.reserva, viagem, viagens);
            await enviarWhatsApp(grupo, msg);
            algum = true;
            resultados.push(`✅ [${mod.nome}] → "${cli?.nome || nomeCliente}" (viagem "${viagem.nome}", primeiro voo ${primeiroVoo.data})`);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nomeCliente, grupo, tentativa: 'sucesso' });
          } catch(e) {
            resultados.push(`❌ [${mod.nome}] "${nomeCliente}": ${e.message}`);
            console.error('  ❌', e.message);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nomeCliente, grupo, tentativa: 'erro', erro: e.message });
          }
        }
        if (algum) {
          await registrarEnvio(mod.id, viagem.id);
          totalAlteracoes++;
        }
      }

    // ── Gatilho: início de viagem ──────────────────────────────────────────
    } else if (mod.gatilho === 'viagem') {
      for (const viagem of viagens) {
        if (!viagem.dataInicio || jaEnviado(mod.id, viagem)) continue;
        const { data, hora } = resolverDataHora('viagem', mod.horaRef, null, viagem);
        const horas = horasAte(data, hora);
        console.log(`  "${viagem.nome}" ${data} → ${horas.toFixed(1)}h`);
        const disparar = deveDisparar(horas, janela);
        logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, horasRestantes: Number(horas.toFixed(2)), janela, disparar });
        if (!disparar) continue;

        const clientesViagem = Array.isArray(viagem.clientes)
          ? viagem.clientes : (viagem.cliente ? [viagem.cliente] : []);

        let algum = false;
        for (const nome of clientesViagem) {
          const cli   = clientes.find(c => c.nome === nome);
          const grupo = cli?.grupo || grupoPorCliente[nome];
          if (!grupo) {
            console.log(`  ⚠️ Cliente "${nome}" sem grupo WhatsApp (Apps Script nem reservas)`);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nome, erro: 'sem grupo WhatsApp' });
            continue;
          }
          try {
            await enviarWhatsApp(grupo, interpolar(mod.texto, cli || { nome }, null, viagem, viagens));
            algum = true;
            resultados.push(`✅ [${mod.nome}] → "${cli?.nome || nome}" (viagem ${data})`);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nome, grupo, tentativa: 'sucesso' });
          } catch(e) {
            resultados.push(`❌ [${mod.nome}] "${nome}": ${e.message}`);
            console.error('  ❌', e.message);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, viagem: viagem.nome, cliente: nome, grupo, tentativa: 'erro', erro: e.message });
          }
        }
        if (algum) {
          await registrarEnvio(mod.id, viagem.id);
          totalAlteracoes++;
        }
      }

    // ── Gatilhos de reserva (voo / hotel) ─────────────────────────────────
    } else {
      for (const res of reservas) {
        if (jaEnviado(mod.id, res)) continue;
        const { data, hora, tipo, local } = resolverDataHora(mod.gatilho, mod.horaRef, res, null);
        if (!data) continue;
        // Verificar tipo de reserva compatível com gatilho
        if ((mod.gatilho === 'checkin') && res.tipo !== 'hotel') continue;
        if ((mod.gatilho.startsWith('voo_')) && res.tipo !== 'voo') continue;
        if ((mod.gatilho.startsWith('seguro_')) && res.tipo !== 'seguro') continue;

        const cli   = clientes.find(c => c.nome === res.cliente);
        // Fallback: a reserva já guarda o grupo (coluna BN) no momento do cadastro.
        // O lookup via Apps Script pode falhar por nome divergente/coluna vazia,
        // então não dependemos exclusivamente dele.
        const grupo = cli?.grupo || res.grupo;

        const horas = horasAte(data, hora, local);
        console.log(`  "${res.cliente}" ${data} ${hora} → ${horas.toFixed(1)}h${grupo ? '' : '  ⚠️ sem grupo WhatsApp (nem via Apps Script, nem na reserva)'}`);

        const disparar = deveDisparar(horas, janela);
        // Loga qualquer reserva próxima da janela (ou dentro dela), com ou sem grupo,
        // pra dar visibilidade mesmo quando o motivo de não disparar é falta de grupo.
        if (disparar || (horas >= 0 && horas <= janela + 6)) {
          logDebug({ modelo: mod.nome, gatilho: mod.gatilho, reservaId: res.id, cliente: res.cliente, horasRestantes: Number(horas.toFixed(2)), janela, temGrupo: !!grupo, disparar });
        }

        if (!grupo) continue;

        if (disparar) {
          try {
            const nomeCliente = cli?.nome || res.cliente;
            await enviarWhatsApp(grupo, interpolar(mod.texto, cli || { nome: res.cliente }, res, null, viagens));
            await registrarEnvio(mod.id, res.id);
            totalAlteracoes++;
            resultados.push(`✅ [${mod.nome}] → "${nomeCliente}" (${data})`);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, reservaId: res.id, cliente: res.cliente, grupo, tentativa: 'sucesso' });
          } catch(e) {
            resultados.push(`❌ [${mod.nome}] "${res.cliente}": ${e.message}`);
            console.error('  ❌', e.message);
            logDebug({ modelo: mod.nome, gatilho: mod.gatilho, reservaId: res.id, cliente: res.cliente, grupo, tentativa: 'erro', erro: e.message, erroStack: String(e.stack||'').slice(0,500) });
          }
        }
      }
    }
  }

  // ── Alerta interno de check-in online (independe de modelos) ─────────────
  totalAlteracoes += await alertarCheckinVoo(reservas, grupoAlertas, resultados);

  // ── Estado de envio ───────────────────────────────────────────────────────
  // Nada é gravado em reservas.json/viagens.json: o registro já foi persistido
  // no ledger logo após cada envio. Além de eliminar a corrida com o painel,
  // corta um GET + um PUT de ~85 KB por execução.
  if (totalAlteracoes > 0) {
    console.log(`\n[lembrete] ${totalAlteracoes} envio(s) registrado(s) em ${LEDGER_FILE}.`);
  } else {
    console.log('\n[lembrete] Nenhum lembrete para enviar nesta execução.');
  }

  console.log('\n=== Resumo ===');
  resultados.forEach(r => console.log(r));
  if (!resultados.length) console.log('(nenhum envio)');

  // ── Salvar log de diagnóstico (sempre, mesmo sem envios) ──────────────────
  try {
    let shaLog;
    try { shaLog = (await githubGet('debug-log.json')).sha; } catch { shaLog = undefined; }
    const payload = {
      executadoEm: new Date().toISOString(),
      modelosAtivos: ativos.map(m => ({ nome: m.nome, gatilho: m.gatilho, antecedencia: m.antecedencia })),
      checkinVoo: { janelaHoras: CHECKIN_JANELA_H, grupo: grupoAlertas || null },
      totalAlteracoes,
      resultados,
      eventos: debugLog
    };
    await githubPut('debug-log.json', payload, shaLog, `chore: debug-log — ${new Date().toISOString().slice(0,16)}`);
    console.log('✅ debug-log.json salvo');
  } catch (e) {
    console.error('⚠️ Falha ao salvar debug-log.json:', e.message);
  }
}

main().catch(e => { console.error('❌ Erro fatal:', e); process.exit(1); });

