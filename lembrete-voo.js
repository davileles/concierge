/**
 * lembrete-voo.js — Clube do Viajante
 * Roda via GitHub Action a cada hora.
 *
 * Cada modelo define:
 *   modo: 'manual' | 'programado'
 *   gatilho: qual campo de data usar como referência
 *     'voo_ida_dt'   → dataIda + horaPartida
 *     'voo_ida_d'    → dataIda (00:00)
 *     'voo_volta_dt' → dataVolta + horaPartidaVolta
 *     'voo_volta_d'  → dataVolta (00:00)
 *     'checkin'      → checkin do hotel (14:00)
 *     'viagem'       → dataInicio da viagem (00:00)
 *   antecedencia: { valor: N, unidade: 'dias' | 'horas' }
 *
 * Modelos com modo 'manual' (ou sem modo) são ignorados.
 * Múltiplos modelos podem apontar para o mesmo gatilho com antecedências diferentes.
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

// A Action roda de hora em hora — margem de 1.5h para absorver desvios do cron
function deveDisparar(horasRestantes, janela) {
  return horasRestantes >= 0 && horasRestantes <= janela && horasRestantes > (janela - 1.5);
}

// Resolve data+hora alvo de cada gatilho para uma reserva
function resolverDataHora(gatilho, res, viagem) {
  switch (gatilho) {
    case 'voo_ida_dt':   return { data: res?.dataIda,    hora: res?.horaPartida        || '00:00', tipo: 'voo' };
    case 'voo_ida_d':    return { data: res?.dataIda,    hora: '00:00',                            tipo: 'voo' };
    case 'voo_volta_dt': return { data: res?.dataVolta,  hora: res?.horaPartidaVolta   || '00:00', tipo: 'voo' };
    case 'voo_volta_d':  return { data: res?.dataVolta,  hora: '00:00',                            tipo: 'voo' };
    case 'checkin':      return { data: res?.checkin,    hora: '14:00',                            tipo: 'hotel' };
    case 'viagem':       return { data: viagem?.dataInicio, hora: '00:00',                         tipo: 'viagem' };
    default:             return { data: null, hora: '00:00', tipo: null };
  }
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
    t = rv(t, 'hora_partida',        res.horaPartida       || '');
    t = rv(t, 'hora_chegada',        res.horaChegada       || '');
    t = rv(t, 'nvoo_ida',            res.nvooIda           || '');
    t = rv(t, 'cia',                 res.ciaIda || res.cia || '');
    t = rv(t, 'data_volta',          fmtDateBR(res.dataVolta));
    t = rv(t, 'hora_partida_volta',  res.horaPartidaVolta  || '');
    t = rv(t, 'hora_chegada_volta',  res.horaChegadaVolta  || '');
    t = rv(t, 'nvoo_volta',          res.nvooVolta         || '');
    t = rv(t, 'cia_volta',           res.ciaVolta          || '');
    t = rv(t, 'origem_volta',        res.origemVolta  || res.destino || '');
    t = rv(t, 'destino_volta',       res.destinoVolta || res.origem  || '');
    t = rv(t, 'classe',              res.classe   || '');
    t = rv(t, 'pnr',                 res.pnr      || '');
    t = rv(t, 'programa',            res.programa || '');
    t = rv(t, 'milhas',              res.milhas   || '');
    t = rv(t, 'pax',                 res.pax      || '');
    t = rv(t, 'hotel',               res.hotelNome || '');
    t = rv(t, 'checkin',             fmtDateBR(res.checkin));
    t = rv(t, 'checkout',            fmtDateBR(res.checkout));
    t = rv(t, 'noites',              res.noites   || '');
    t = rv(t, 'conf',                res.conf     || '');
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

// Chave única por modelo para evitar reenvio
function flagKey(modeloId) { return `enviado_${modeloId}`; }

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

  const [reservasResp, modelosResp, viagensResp, clientes] = await Promise.all([
    githubGet('reservas.json'),
    githubGet('modelos.json'),
    githubGet('viagens.json').catch(() => ({ data: [], sha: null })),
    carregarClientes().catch(e => { console.warn('[clientes]', e.message); return []; })
  ]);

  const reservas = reservasResp.data;
  const modelos  = modelosResp.data.map(normalizarModelo);
  const viagens  = Array.isArray(viagensResp.data)
    ? viagensResp.data
    : (viagensResp.data?.items || []);

  const ativos = modelos.filter(m => m.modo === 'programado' && m.gatilho && m.antecedencia);

  if (!ativos.length) {
    console.log('[lembrete] Nenhum modelo programado cadastrado.');
    return;
  }

  console.log(`[lembrete] ${ativos.length} modelo(s) programado(s) | ${reservas.length} reservas | ${clientes.length} clientes`);
  ativos.forEach(m => {
    const ant = `${m.antecedencia.valor} ${m.antecedencia.unidade}`;
    console.log(`  • "${m.nome}" → ${m.gatilho} · ${ant} antes`);
  });

  let totalAlteracoes = 0;
  const resultados = [];
  let viagensAlteradas = false;

  for (const mod of ativos) {
    const janela = antecedenciaEmHoras(mod.antecedencia);
    const key    = flagKey(mod.id);
    const isViagem = mod.gatilho === 'viagem';

    console.log(`\n[${mod.nome}] gatilho=${mod.gatilho} janela=${janela}h`);

    if (isViagem) {
      // ── Gatilho: início de viagem ──
      for (const viagem of viagens) {
        if (!viagem.dataInicio || viagem[key]) continue;
        const { data, hora } = resolverDataHora('viagem', null, viagem);
        const horas = horasAte(data, hora);
        console.log(`  "${viagem.nome}" ${data} → ${horas.toFixed(1)}h`);
        if (!deveDisparar(horas, janela)) continue;

        const clientesViagem = Array.isArray(viagem.clientes)
          ? viagem.clientes : (viagem.cliente ? [viagem.cliente] : []);

        let algum = false;
        for (const nome of clientesViagem) {
          const cli = clientes.find(c => c.nome === nome);
          if (!cli?.grupo) continue;
          try {
            await enviarWhatsApp(cli.grupo, interpolar(mod.texto, cli, null, viagem));
            algum = true;
            resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (viagem ${data})`);
          } catch(e) {
            resultados.push(`❌ [${mod.nome}] "${nome}": ${e.message}`);
            console.error('  ❌', e.message);
          }
        }
        if (algum) {
          viagem[key] = true;
          viagem[`${key}Em`] = new Date().toISOString();
          totalAlteracoes++;
          viagensAlteradas = true;
        }
      }
    } else {
      // ── Gatilhos de reserva (voo / hotel) ──
      for (const res of reservas) {
        if (res[key]) continue;
        const { data, hora, tipo } = resolverDataHora(mod.gatilho, res, null);
        if (!data) continue;
        // Verificar tipo de reserva compatível com gatilho
        if ((mod.gatilho === 'checkin') && res.tipo !== 'hotel') continue;
        if ((mod.gatilho.startsWith('voo_')) && res.tipo !== 'voo') continue;

        const cli = clientes.find(c => c.nome === res.cliente);
        if (!cli?.grupo) continue;

        const horas = horasAte(data, hora);
        console.log(`  "${res.cliente}" ${data} ${hora} → ${horas.toFixed(1)}h`);

        if (deveDisparar(horas, janela)) {
          try {
            await enviarWhatsApp(cli.grupo, interpolar(mod.texto, cli, res, null));
            res[key] = true;
            res[`${key}Em`] = new Date().toISOString();
            totalAlteracoes++;
            resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (${data})`);
          } catch(e) {
            resultados.push(`❌ [${mod.nome}] "${cli.nome}": ${e.message}`);
            console.error('  ❌', e.message);
          }
        }
      }
    }
  }

  // ── Salvar alterações ─────────────────────────────────────────────────────
  if (totalAlteracoes > 0) {
    console.log(`\n[lembrete] Salvando ${totalAlteracoes} alteração(ões)…`);
    const { sha: shaRes } = await githubGet('reservas.json');
    await githubPut('reservas.json', reservas, shaRes,
      `chore: lembretes enviados — ${new Date().toISOString().slice(0,16)}`);
    console.log('✅ reservas.json salvo');

    if (viagensAlteradas) {
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
