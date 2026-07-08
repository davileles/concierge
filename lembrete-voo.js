/**
 * lembrete-voo.js — Clube do Viajante
 * Roda via GitHub Action a cada hora.
 *
 * Cada modelo define seu próprio gatilho e antecedência:
 *   gatilho: 'voo_ida' | 'voo_volta' | 'checkin' | 'viagem' | '' (manual)
 *   antecedencia: { valor: 2, unidade: 'dias' | 'horas' }
 *
 * Modelos sem gatilho são ignorados (envio manual pelo painel).
 * Múltiplos modelos podem ter o mesmo gatilho com antecedências diferentes.
 */

const BAILEYS      = 'https://baileys-server-production-ebfe.up.railway.app';
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

function horasAte(dataISO, horario) {
  if (!dataISO) return Infinity;
  const [h, min] = (horario || '00:00').split(':').map(Number);
  const dt = new Date(
    `${dataISO}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00-03:00`
  );
  return (dt.getTime() - Date.now()) / 3_600_000;
}

function antecedenciaEmHoras(ant) {
  if (!ant || !ant.valor) return 48;
  return ant.unidade === 'horas' ? Number(ant.valor) : Number(ant.valor) * 24;
}

// A Action roda de hora em hora — a fatia de cada execução é ~1h.
// Usamos 1.5h de margem para absorver desvios do cron.
function deveDisparar(horasRestantes, janela) {
  return horasRestantes >= 0 && horasRestantes <= janela && horasRestantes > (janela - 1.5);
}

// ── interpolação ──────────────────────────────────────────────────────────────
function interpolar(texto, cli, res, viagem) {
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
    t = rv(t, 'origem',              res.origem    || '');
    t = rv(t, 'destino',             res.destino   || '');
    t = rv(t, 'data_ida',            fmtDateBR(res.dataIda));
    t = rv(t, 'hora_partida',        res.horaPartida        || '');
    t = rv(t, 'hora_chegada',        res.horaChegada        || '');
    t = rv(t, 'nvoo_ida',            res.nvooIda            || '');
    t = rv(t, 'cia',                 res.ciaIda || res.cia  || '');
    t = rv(t, 'data_volta',          fmtDateBR(res.dataVolta));
    t = rv(t, 'hora_partida_volta',  res.horaPartidaVolta   || '');
    t = rv(t, 'hora_chegada_volta',  res.horaChegadaVolta   || '');
    t = rv(t, 'nvoo_volta',          res.nvooVolta          || '');
    t = rv(t, 'cia_volta',           res.ciaVolta           || '');
    t = rv(t, 'origem_volta',        res.origemVolta  || res.destino  || '');
    t = rv(t, 'destino_volta',       res.destinoVolta || res.origem   || '');
    t = rv(t, 'classe',              res.classe    || '');
    t = rv(t, 'pnr',                 res.pnr       || '');
    t = rv(t, 'programa',            res.programa  || '');
    t = rv(t, 'milhas',              res.milhas    || '');
    t = rv(t, 'pax',                 res.pax       || '');
    t = rv(t, 'hotel',               res.hotelNome || '');
    t = rv(t, 'checkin',             fmtDateBR(res.checkin));
    t = rv(t, 'checkout',            fmtDateBR(res.checkout));
    t = rv(t, 'noites',              res.noites    || '');
    t = rv(t, 'conf',                res.conf      || '');
  }
  if (viagem) {
    t = rv(t, 'viagem_nome',         viagem.nome        || '');
    t = rv(t, 'viagem_destino',      viagem.destino     || '');
    t = rv(t, 'viagem_data_inicio',  fmtDateBR(viagem.dataInicio));
    t = rv(t, 'viagem_data_fim',     fmtDateBR(viagem.dataFim));
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

// ── clientes via Apps Script ──────────────────────────────────────────────────
async function carregarClientes() {
  const { data: cfg } = await githubGet('cfg.json');
  if (!cfg.url) return [];
  const url = `${cfg.url}?aba=${encodeURIComponent(cfg.aba || 'Respostas ao formulário 1')}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apps Script → ${r.status}`);
  const rows = await r.json();
  const ci = col => col ? col.toUpperCase().charCodeAt(0) - 65 : -1;
  return rows.slice(1).map(row => ({
    nome:   String(row[ci(cfg.colNome  ||'C')]||'').trim(),
    tel:    String(row[ci(cfg.colTel   ||'D')]||'').trim(),
    email:  String(row[ci(cfg.colEmail ||'E')]||'').trim(),
    cpf:    String(row[ci(cfg.colCpf   ||'F')]||'').trim(),
    cidade: String(row[ci(cfg.colCidade||'O')]||'').trim(),
    grupo:  String(row[ci(cfg.colGrupo ||'B')]||'').trim(),
  })).filter(c => c.nome);
}

// ── envio ─────────────────────────────────────────────────────────────────────
async function enviarWhatsApp(grupoId, mensagem) {
  const r = await fetch(`${BAILEYS}/enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grupo: grupoId, mensagem })
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.erro || 'Falha no envio');
}

// Chave de marcação única por modelo (evita reenvio)
function flagKey(modeloId) { return `enviado_${modeloId}`; }

// ── processamento por gatilho ─────────────────────────────────────────────────
async function processarGatilhoVoo(mod, reservas, clientes, campo, horaPartida, resultados) {
  const janela = antecedenciaEmHoras(mod.antecedencia);
  const key    = flagKey(mod.id);
  let alteracoes = 0;

  for (const res of reservas) {
    if (res.tipo !== 'voo') continue;
    if (res[key]) continue;

    const dataAlvo = res[campo];
    const hora     = res[horaPartida];
    if (!dataAlvo) continue;

    const cli = clientes.find(c => c.nome === res.cliente);
    if (!cli?.grupo) continue;

    const horas = horasAte(dataAlvo, hora);
    console.log(`  [${mod.gatilho}] "${res.cliente}" ${dataAlvo} → ${horas.toFixed(1)}h (janela ≤${janela}h)`);

    if (deveDisparar(horas, janela)) {
      try {
        await enviarWhatsApp(cli.grupo, interpolar(mod.texto, cli, res, null));
        res[key] = true;
        res[`${key}Em`] = new Date().toISOString();
        alteracoes++;
        resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (${dataAlvo})`);
      } catch(e) {
        resultados.push(`❌ [${mod.nome}] "${cli.nome}": ${e.message}`);
        console.error(`  ❌`, e.message);
      }
    }
  }
  return alteracoes;
}

async function processarGatilhoCheckin(mod, reservas, clientes, resultados) {
  const janela = antecedenciaEmHoras(mod.antecedencia);
  const key    = flagKey(mod.id);
  let alteracoes = 0;

  for (const res of reservas) {
    if (res.tipo !== 'hotel') continue;
    if (res[key] || !res.checkin) continue;

    const cli = clientes.find(c => c.nome === res.cliente);
    if (!cli?.grupo) continue;

    const horas = horasAte(res.checkin, '14:00');
    console.log(`  [checkin] "${res.cliente}" ${res.checkin} → ${horas.toFixed(1)}h (janela ≤${janela}h)`);

    if (deveDisparar(horas, janela)) {
      try {
        await enviarWhatsApp(cli.grupo, interpolar(mod.texto, cli, res, null));
        res[key] = true;
        res[`${key}Em`] = new Date().toISOString();
        alteracoes++;
        resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (check-in ${res.checkin})`);
      } catch(e) {
        resultados.push(`❌ [${mod.nome}] "${cli.nome}": ${e.message}`);
        console.error(`  ❌`, e.message);
      }
    }
  }
  return alteracoes;
}

async function processarGatilhoViagem(mod, viagens, clientes, resultados) {
  const janela = antecedenciaEmHoras(mod.antecedencia);
  const key    = flagKey(mod.id);
  let alteracoes = 0;

  for (const viagem of viagens) {
    if (!viagem.dataInicio || viagem[key]) continue;

    const horas = horasAte(viagem.dataInicio, '00:00');
    console.log(`  [viagem] "${viagem.nome}" ${viagem.dataInicio} → ${horas.toFixed(1)}h (janela ≤${janela}h)`);

    if (!deveDisparar(horas, janela)) continue;

    const clientesViagem = Array.isArray(viagem.clientes)
      ? viagem.clientes
      : (viagem.cliente ? [viagem.cliente] : []);

    let algumEnviado = false;
    for (const nome of clientesViagem) {
      const cli = clientes.find(c => c.nome === nome);
      if (!cli?.grupo) continue;
      try {
        await enviarWhatsApp(cli.grupo, interpolar(mod.texto, cli, null, viagem));
        algumEnviado = true;
        resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (viagem ${viagem.dataInicio})`);
      } catch(e) {
        resultados.push(`❌ [${mod.nome}] "${nome}": ${e.message}`);
        console.error(`  ❌`, e.message);
      }
    }
    if (algumEnviado) {
      viagem[key] = true;
      viagem[`${key}Em`] = new Date().toISOString();
      alteracoes++;
    }
  }
  return alteracoes;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[lembrete] Iniciando — ${new Date().toLocaleString('pt-BR', { timeZone: TZ_SP })}`);

  if (!GITHUB_TOKEN) { console.error('❌ CDV_GITHUB_TOKEN não definido'); process.exit(1); }

  const [reservasResp, modelosResp, viagensResp, clientes] = await Promise.all([
    githubGet('reservas.json'),
    githubGet('modelos.json'),
    githubGet('viagens.json').catch(() => ({ data: [], sha: null })),
    carregarClientes().catch(e => { console.warn('[clientes]', e.message); return []; })
  ]);

  const reservas = reservasResp.data;
  const modelos  = modelosResp.data;
  const viagens  = Array.isArray(viagensResp.data)
    ? viagensResp.data
    : (viagensResp.data?.items || []);

  // Compatibilidade: modelos antigos usavam campo 'tipo' — migrar para 'gatilho'
  const MIGRAR = { lembrete_ida:'voo_ida', lembrete_volta:'voo_volta', lembrete_checkin:'checkin', lembrete_viagem:'viagem' };
  modelos.forEach(m => {
    if (!m.gatilho && m.tipo && MIGRAR[m.tipo]) m.gatilho = MIGRAR[m.tipo];
  });

  // Filtrar modelos com gatilho automático
  const ativos = modelos.filter(m => m.gatilho);
  if (!ativos.length) {
    console.log('[lembrete] Nenhum modelo com gatilho automático cadastrado.');
    return;
  }

  console.log(`[lembrete] ${ativos.length} modelo(s) ativo(s) | ${reservas.length} reservas | ${clientes.length} clientes`);
  ativos.forEach(m => {
    const ant = m.antecedencia ? `${m.antecedencia.valor} ${m.antecedencia.unidade}` : '?';
    console.log(`  • "${m.nome}" → gatilho: ${m.gatilho}, antecedência: ${ant}`);
  });

  let totalAlteracoes = 0;
  const resultados = [];

  for (const mod of ativos) {
    console.log(`\n[${mod.nome}]`);
    let n = 0;
    if      (mod.gatilho === 'voo_ida')  n = await processarGatilhoVoo(mod, reservas, clientes, 'dataIda',   'horaPartida',       resultados);
    else if (mod.gatilho === 'voo_volta') n = await processarGatilhoVoo(mod, reservas, clientes, 'dataVolta', 'horaPartidaVolta',  resultados);
    else if (mod.gatilho === 'checkin')  n = await processarGatilhoCheckin(mod, reservas, clientes, resultados);
    else if (mod.gatilho === 'viagem')   n = await processarGatilhoViagem(mod, viagens, clientes, resultados);
    else console.log(`  gatilho desconhecido: ${mod.gatilho}`);
    totalAlteracoes += n;
  }

  if (totalAlteracoes > 0) {
    console.log(`\n[lembrete] Salvando ${totalAlteracoes} alteração(ões)…`);
    const { sha: shaRes } = await githubGet('reservas.json');
    await githubPut('reservas.json', reservas, shaRes,
      `chore: lembretes enviados — ${new Date().toISOString().slice(0,16)}`);
    console.log('✅ reservas.json salvo');

    if (viagens.length && ativos.some(m => m.gatilho === 'viagem')) {
      const { sha: shaVia } = await githubGet('viagens.json');
      await githubPut('viagens.json', viagensResp.data, shaVia,
        `chore: lembretes de viagem enviados — ${new Date().toISOString().slice(0,16)}`);
      console.log('✅ viagens.json salvo');
    }
  } else {
    console.log('\n[lembrete] Nenhum lembrete para enviar nesta execução.');
  }

  console.log('\n=== Resumo ===');
  resultados.forEach(r => console.log(r));
  if (!resultados.length) console.log('(nenhum envio)');
}

main().catch(e => { console.error('❌ Erro fatal:', e); process.exit(1); });
