/**
 * lembrete-voo.js — Clube do Viajante
 * Roda via GitHub Action a cada hora.
 *
 * Para cada modelo do tipo lembrete_*, lê a antecedência configurada
 * (ex: { valor: 2, unidade: 'dias' }) e verifica se a data-alvo da
 * reserva entra na janela de disparo.
 *
 * Tipos suportados:
 *   lembrete_ida     → res.dataIda     + res.horaPartida
 *   lembrete_volta   → res.dataVolta   + res.horaPartidaVolta
 *   lembrete_checkin → res.checkin     (hotel)
 *   lembrete_viagem  → viagem.dataInicio (via viagens.json)
 */

const BAILEYS  = 'https://baileys-server-production-ebfe.up.railway.app';
const GITHUB_TOKEN = process.env.CDV_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO     = 'davileles/concierge';
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;
const TZ_SP    = 'America/Sao_Paulo';

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtDateBR(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Retorna quanto tempo (em horas) falta até a data/hora alvo.
 * dataISO: "2026-08-16", horario: "14:05" (ou vazio → 00:00)
 */
function horasAte(dataISO, horario) {
  if (!dataISO) return Infinity;
  const [h, min] = (horario || '00:00').split(':').map(Number);
  const dt = new Date(
    `${dataISO}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00-03:00`
  );
  return (dt.getTime() - Date.now()) / 3_600_000;
}

/**
 * Converte antecedência { valor, unidade } → horas.
 * unidade: 'horas' | 'dias'
 */
function antecedenciaEmHoras(ant) {
  if (!ant || !ant.valor) return 48; // fallback caso modelo antigo
  return ant.unidade === 'horas' ? ant.valor : ant.valor * 24;
}

/**
 * Janela de disparo: envia quando
 *   horasAte >= 0  (não passou ainda)
 *   horasAte <= janela  (já entrou na antecedência configurada)
 *   horasAte >  janela - 1  (não disparou na hora anterior)
 *
 * A action roda a cada hora, então a "fatia" de cada execução é de ~1h.
 * Usamos uma margem de ±1h para absorver pequenos desvios de agendamento.
 */
function deveDisparar(horasRestantes, janela) {
  return horasRestantes >= 0 && horasRestantes <= janela && horasRestantes > (janela - 1.5);
}

// ── interpolação ──────────────────────────────────────────────────────────────
function interpolar(texto, cli, res, viagem) {
  const rv = (t, key, val) => t.split(`{{${key}}}`).join(val || '');
  let t = texto;
  // cliente
  t = rv(t, 'nome',          cli.nome || '');
  t = rv(t, 'primeiro_nome', (cli.nome || '').split(' ')[0]);
  t = rv(t, 'telefone',      cli.tel   || '');
  t = rv(t, 'email',         cli.email || '');
  t = rv(t, 'cpf',           cli.cpf   || '');
  t = rv(t, 'cidade',        cli.cidade || '');
  // reserva — voo ida
  if (res) {
    t = rv(t, 'origem',              res.origem    || '');
    t = rv(t, 'destino',             res.destino   || '');
    t = rv(t, 'data_ida',            fmtDateBR(res.dataIda));
    t = rv(t, 'hora_partida',        res.horaPartida        || '');
    t = rv(t, 'hora_chegada',        res.horaChegada        || '');
    t = rv(t, 'nvoo_ida',            res.nvooIda            || '');
    t = rv(t, 'cia',                 res.ciaIda || res.cia  || '');
    // voo volta
    t = rv(t, 'data_volta',          fmtDateBR(res.dataVolta));
    t = rv(t, 'hora_partida_volta',  res.horaPartidaVolta   || '');
    t = rv(t, 'hora_chegada_volta',  res.horaChegadaVolta   || '');
    t = rv(t, 'nvoo_volta',          res.nvooVolta          || '');
    t = rv(t, 'cia_volta',           res.ciaVolta           || '');
    t = rv(t, 'origem_volta',        res.origemVolta  || res.destino  || '');
    t = rv(t, 'destino_volta',       res.destinoVolta || res.origem   || '');
    // hotel
    t = rv(t, 'hotel',               res.hotelNome || '');
    t = rv(t, 'checkin',             fmtDateBR(res.checkin));
    t = rv(t, 'checkout',            fmtDateBR(res.checkout));
    t = rv(t, 'noites',              res.noites    || '');
    t = rv(t, 'conf',                res.conf      || '');
    // geral
    t = rv(t, 'classe',              res.classe    || '');
    t = rv(t, 'pnr',                 res.pnr       || '');
    t = rv(t, 'programa',            res.programa  || '');
    t = rv(t, 'milhas',              res.milhas    || '');
    t = rv(t, 'pax',                 res.pax       || '');
  }
  // viagem
  if (viagem) {
    t = rv(t, 'viagem_nome',        viagem.nome       || '');
    t = rv(t, 'viagem_destino',     viagem.destino    || '');
    t = rv(t, 'viagem_data_inicio', fmtDateBR(viagem.dataInicio));
    t = rv(t, 'viagem_data_fim',    fmtDateBR(viagem.dataFim));
    t = rv(t, 'viagem_pax',         viagem.pax        || '');
  }
  return t;
}

// ── GitHub API ────────────────────────────────────────────────────────────────
async function githubGet(path) {
  const r = await fetch(`${API_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });
  if (!r.ok) throw new Error(`GitHub GET ${path} → ${r.status}`);
  const d = await r.json();
  const content = Buffer.from(d.content.replace(/\n/g,''), 'base64').toString('utf-8');
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
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`GitHub PUT ${path} → ${r.status}: ${err.slice(0,200)}`);
  }
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
  const c = cfg;
  return rows.slice(1).map(row => ({
    nome:   String(row[ci(c.colNome  ||'C')]||'').trim(),
    tel:    String(row[ci(c.colTel   ||'D')]||'').trim(),
    email:  String(row[ci(c.colEmail ||'E')]||'').trim(),
    cpf:    String(row[ci(c.colCpf   ||'F')]||'').trim(),
    nasc:   String(row[ci(c.colNasc  ||'H')]||'').trim(),
    cidade: String(row[ci(c.colCidade||'O')]||'').trim(),
    grupo:  String(row[ci(c.colGrupo ||'B')]||'').trim(),
  })).filter(c => c.nome);
}

// ── envio via Baileys ─────────────────────────────────────────────────────────
async function enviarWhatsApp(grupoId, mensagem) {
  const r = await fetch(`${BAILEYS}/enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grupo: grupoId, mensagem })
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.erro || 'Falha no envio');
  return d;
}

// ── chave única de marcação por modelo ───────────────────────────────────────
function flagKey(modeloId) {
  // ex: "lembreteEnviado_MOD-1783506805708"
  return `lembreteEnviado_${modeloId}`;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: TZ_SP });
  console.log(`[lembrete-voo] Iniciando — ${agora}`);

  if (!GITHUB_TOKEN) { console.error('❌ CDV_GITHUB_TOKEN não definido'); process.exit(1); }

  // 1. Carregar dados em paralelo
  const [reservasResp, modelosResp, viagensResp, clientes] = await Promise.all([
    githubGet('reservas.json'),
    githubGet('modelos.json'),
    githubGet('viagens.json').catch(() => ({ data: [], sha: null })),
    carregarClientes().catch(e => { console.warn('[clientes]', e.message); return []; })
  ]);

  const reservas = reservasResp.data;
  const modelos  = modelosResp.data;
  const viagens  = Array.isArray(viagensResp.data) ? viagensResp.data : (viagensResp.data?.items || []);

  // 2. Filtrar só modelos de lembrete com antecedência configurada
  const TIPOS_LEMBRETE = ['lembrete_ida','lembrete_volta','lembrete_checkin','lembrete_viagem'];
  const modelosAtivos = modelos.filter(m => TIPOS_LEMBRETE.includes(m.tipo));

  if (!modelosAtivos.length) {
    console.log('[lembrete-voo] Nenhum modelo de lembrete cadastrado.');
    return;
  }

  console.log(`[lembrete-voo] Modelos ativos: ${modelosAtivos.map(m => `${m.nome} (${m.tipo}, ${m.antecedencia?.valor||'?'} ${m.antecedencia?.unidade||'?'})`).join(' | ')}`);
  console.log(`[lembrete-voo] Reservas: ${reservas.length} | Viagens: ${viagens.length} | Clientes: ${clientes.length}`);

  let alteracoes = 0;
  const resultados = [];

  for (const mod of modelosAtivos) {
    const janela = antecedenciaEmHoras(mod.antecedencia);
    const key    = flagKey(mod.id);

    // ── Modelos de VOO (ida / volta) ──────────────────────────────────────────
    if (mod.tipo === 'lembrete_ida' || mod.tipo === 'lembrete_volta') {
      for (const res of reservas) {
        if (res.tipo !== 'voo') continue;
        if (res[key]) continue; // já enviado para este modelo

        const cli = clientes.find(c => c.nome === res.cliente);
        if (!cli?.grupo) continue;

        const dataAlvo  = mod.tipo === 'lembrete_ida' ? res.dataIda   : res.dataVolta;
        const horaAlvo  = mod.tipo === 'lembrete_ida' ? res.horaPartida : res.horaPartidaVolta;
        if (!dataAlvo) continue;

        const horas = horasAte(dataAlvo, horaAlvo);
        const label = `${res.id} "${res.cliente}" ${dataAlvo}`;
        console.log(`[${mod.tipo}] ${label} → ${horas.toFixed(1)}h (janela: ≤${janela}h)`);

        if (deveDisparar(horas, janela)) {
          try {
            const msg = interpolar(mod.texto, cli, res, null);
            await enviarWhatsApp(cli.grupo, msg);
            res[key] = true;
            res[`${key}Em`] = new Date().toISOString();
            alteracoes++;
            resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (${dataAlvo})`);
            console.log(`✅ Enviado: ${mod.nome} → ${cli.nome}`);
          } catch (e) {
            resultados.push(`❌ [${mod.nome}] "${cli.nome}": ${e.message}`);
            console.error(`❌ Erro:`, e.message);
          }
        }
      }
    }

    // ── Modelo de CHECK-IN (hotel) ────────────────────────────────────────────
    if (mod.tipo === 'lembrete_checkin') {
      for (const res of reservas) {
        if (res.tipo !== 'hotel') continue;
        if (res[key]) continue;
        if (!res.checkin) continue;

        const cli = clientes.find(c => c.nome === res.cliente);
        if (!cli?.grupo) continue;

        const horas = horasAte(res.checkin, '14:00'); // horário padrão de checkin
        const label = `${res.id} "${res.cliente}" hotel ${res.checkin}`;
        console.log(`[lembrete_checkin] ${label} → ${horas.toFixed(1)}h (janela: ≤${janela}h)`);

        if (deveDisparar(horas, janela)) {
          try {
            const msg = interpolar(mod.texto, cli, res, null);
            await enviarWhatsApp(cli.grupo, msg);
            res[key] = true;
            res[`${key}Em`] = new Date().toISOString();
            alteracoes++;
            resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (check-in ${res.checkin})`);
            console.log(`✅ Enviado: ${mod.nome} → ${cli.nome}`);
          } catch (e) {
            resultados.push(`❌ [${mod.nome}] "${cli.nome}": ${e.message}`);
            console.error(`❌ Erro:`, e.message);
          }
        }
      }
    }

    // ── Modelo de INÍCIO DE VIAGEM ────────────────────────────────────────────
    if (mod.tipo === 'lembrete_viagem') {
      for (const viagem of viagens) {
        if (!viagem.dataInicio) continue;
        if (viagem[key]) continue;

        // Viagem tem clientes associados (array de nomes)
        const clientesViagem = Array.isArray(viagem.clientes)
          ? viagem.clientes
          : (viagem.cliente ? [viagem.cliente] : []);

        const horas = horasAte(viagem.dataInicio, '00:00');
        console.log(`[lembrete_viagem] "${viagem.nome}" ${viagem.dataInicio} → ${horas.toFixed(1)}h (janela: ≤${janela}h)`);

        if (!deveDisparar(horas, janela)) continue;

        let algumEnviado = false;
        for (const nomeCliente of clientesViagem) {
          const cli = clientes.find(c => c.nome === nomeCliente);
          if (!cli?.grupo) continue;
          try {
            const msg = interpolar(mod.texto, cli, null, viagem);
            await enviarWhatsApp(cli.grupo, msg);
            algumEnviado = true;
            resultados.push(`✅ [${mod.nome}] → "${cli.nome}" (viagem ${viagem.dataInicio})`);
            console.log(`✅ Enviado: ${mod.nome} → ${cli.nome}`);
          } catch (e) {
            resultados.push(`❌ [${mod.nome}] "${nomeCliente}": ${e.message}`);
            console.error(`❌ Erro:`, e.message);
          }
        }
        if (algumEnviado) {
          viagem[key] = true;
          viagem[`${key}Em`] = new Date().toISOString();
          alteracoes++;
        }
      }
    }
  }

  // 3. Persistir alterações
  if (alteracoes > 0) {
    console.log(`\n[lembrete-voo] Salvando ${alteracoes} alteração(ões)…`);

    const { sha: shaRes } = await githubGet('reservas.json');
    await githubPut('reservas.json', reservas, shaRes,
      `chore: lembrete(s) enviado(s) — ${new Date().toISOString().slice(0,16)}`);
    console.log('✅ reservas.json salvo');

    if (viagens.length) {
      const { sha: shaVia } = await githubGet('viagens.json');
      await githubPut('viagens.json', viagensResp.data, shaVia,
        `chore: lembrete(s) de viagem enviado(s) — ${new Date().toISOString().slice(0,16)}`);
      console.log('✅ viagens.json salvo');
    }
  } else {
    console.log('\n[lembrete-voo] Nenhum lembrete para enviar nesta execução.');
  }

  console.log('\n=== Resumo ===');
  resultados.forEach(r => console.log(r));
  if (!resultados.length) console.log('(nenhum envio)');
}

main().catch(e => { console.error('❌ Erro fatal:', e); process.exit(1); });
