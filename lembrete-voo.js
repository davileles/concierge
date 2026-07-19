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
 *     'viagem'             → dataInicio da viagem (00:00)
 *     'primeiro_voo_viagem'→ data+hora do primeiro voo da viagem (por viagem)
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
    case 'voo_ida_dt':   return { data: res?.dataIda,       hora: res?.horaPartida      || '00:00', tipo: 'voo'    };
    case 'voo_ida_d':    return { data: res?.dataIda,       hora: ref,                              tipo: 'voo'    };
    case 'voo_volta_dt': return { data: res?.dataVolta,     hora: res?.horaPartidaVolta || '00:00', tipo: 'voo'    };
    case 'voo_volta_d':  return { data: res?.dataVolta,     hora: ref,                              tipo: 'voo'    };
    case 'checkin':      return { data: res?.checkin,       hora: ref,                              tipo: 'hotel'  };
    case 'viagem':       return { data: viagem?.dataInicio, hora: ref,                              tipo: 'viagem' };
    default:             return { data: null, hora: '00:00', tipo: null };
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
      melhor = { data: res.dataIda, hora: horaPartida, reserva: res };
      continue;
    }
    // Comparar data + hora
    const dtAtual  = new Date(`${res.dataIda}T${horaPartida}:00-03:00`);
    const dtMelhor = new Date(`${melhor.data}T${melhor.hora}:00-03:00`);
    if (dtAtual < dtMelhor) {
      melhor = { data: res.dataIda, hora: horaPartida, reserva: res };
    }
  }

  return melhor;
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
    t = rv(t, 'origem',              res.origem    || '');
    t = rv(t, 'destino',             res.destino   || '');
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let r;
  try {
    r = await fetch(`${BAILEYS}/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grupo: grupoId, mensagem }),
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

// Chave única por modelo para evitar reenvio
function flagKey(modeloId) { return `enviado_${modeloId}`; }

// ── log de diagnóstico ──────────────────────────────────────────────────────
// Registrado a cada execução em debug-log.json, independente de ter havido
// envio ou não. Objetivo: dar visibilidade real sobre por que um lembrete
// disparou ou não, sem depender dos logs nativos da Action.
const debugLog = [];
function logDebug(entry) {
  debugLog.push({ ...entry, ts: new Date().toISOString() });
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

    console.log(`\n[${mod.nome}] gatilho=${mod.gatilho} janela=${janela}h`);

    // ── Gatilho: primeiro voo da viagem ────────────────────────────────────
    if (mod.gatilho === 'primeiro_voo_viagem') {
      for (const viagem of viagens) {
        if (viagem[key]) continue; // já enviado para esta viagem

        const primeiroVoo = resolverPrimeiroVoo(viagem, reservasMap);
        if (!primeiroVoo) {
          console.log(`  "${viagem.nome}" — sem voos vinculados, ignorando`);
          continue;
        }

        const horas = horasAte(primeiroVoo.data, primeiroVoo.hora);
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
          viagem[key] = true;
          viagem[`${key}Em`] = new Date().toISOString();
          totalAlteracoes++;
          viagensAlteradas = true;
        }
      }

    // ── Gatilho: início de viagem ──────────────────────────────────────────
    } else if (mod.gatilho === 'viagem') {
      for (const viagem of viagens) {
        if (!viagem.dataInicio || viagem[key]) continue;
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
          viagem[key] = true;
          viagem[`${key}Em`] = new Date().toISOString();
          totalAlteracoes++;
          viagensAlteradas = true;
        }
      }

    // ── Gatilhos de reserva (voo / hotel) ─────────────────────────────────
    } else {
      for (const res of reservas) {
        if (res[key]) continue;
        const { data, hora, tipo } = resolverDataHora(mod.gatilho, mod.horaRef, res, null);
        if (!data) continue;
        // Verificar tipo de reserva compatível com gatilho
        if ((mod.gatilho === 'checkin') && res.tipo !== 'hotel') continue;
        if ((mod.gatilho.startsWith('voo_')) && res.tipo !== 'voo') continue;

        const cli   = clientes.find(c => c.nome === res.cliente);
        // Fallback: a reserva já guarda o grupo (coluna BN) no momento do cadastro.
        // O lookup via Apps Script pode falhar por nome divergente/coluna vazia,
        // então não dependemos exclusivamente dele.
        const grupo = cli?.grupo || res.grupo;

        const horas = horasAte(data, hora);
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
            res[key] = true;
            res[`${key}Em`] = new Date().toISOString();
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

  // ── Salvar log de diagnóstico (sempre, mesmo sem envios) ──────────────────
  try {
    let shaLog;
    try { shaLog = (await githubGet('debug-log.json')).sha; } catch { shaLog = undefined; }
    const payload = {
      executadoEm: new Date().toISOString(),
      modelosAtivos: ativos.map(m => ({ nome: m.nome, gatilho: m.gatilho, antecedencia: m.antecedencia })),
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

