/**
 * lembrete-voo.js — Clube do Viajante
 * Roda via GitHub Action a cada hora.
 * Para cada reserva de voo, verifica se ida ou volta está a ≤ 48h.
 * Se sim, e ainda não foi enviado o lembrete, envia via Baileys e
 * marca a reserva com lembreteIdaEnviado / lembreteVoltaEnviado.
 */

const PROXY       = 'https://cdv-proxy-production.up.railway.app';
const BAILEYS     = 'https://baileys-server-production-ebfe.up.railway.app';
const SHEETS_URL  = process.env.SHEETS_URL || '';          // Apps Script URL (opcional, lido do cfg)
const GITHUB_TOKEN = process.env.CDV_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO        = 'davileles/concierge';
const API_BASE    = `https://api.github.com/repos/${REPO}/contents`;

const TZ_SP = 'America/Sao_Paulo';
const JANELA_HORAS = 48;   // enviar com até N horas de antecedência
const JANELA_MIN   = 1;    // mas não menos de N hora antes (evita reenvio no mesmo dia)

// ── helpers ──────────────────────────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function fmtDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function horasAte(dataISO, horario) {
  // dataISO: "2026-08-16", horario: "14:05" (ou vazio → usa 00:00)
  const [h, min] = (horario || '00:00').split(':').map(Number);
  const dt = new Date(`${dataISO}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00-03:00`);
  return (dt.getTime() - Date.now()) / 3_600_000;
}

function interpolar(texto, cli, res, trecho) {
  // trecho: 'ida' | 'volta'
  const rv = (t, key, val) => t.split(`{{${key}}}`).join(val || '');
  let t = texto;
  // cliente
  t = rv(t, 'nome',          cli.nome || '');
  t = rv(t, 'primeiro_nome', (cli.nome || '').split(' ')[0]);
  t = rv(t, 'telefone',      cli.tel  || '');
  t = rv(t, 'email',         cli.email || '');
  t = rv(t, 'cpf',           cli.cpf  || '');
  t = rv(t, 'cidade',        cli.cidade || '');
  // reserva — variáveis genéricas
  t = rv(t, 'origem',             res.origem   || '');
  t = rv(t, 'destino',            res.destino  || '');
  t = rv(t, 'classe',             res.classe   || '');
  t = rv(t, 'pnr',                res.pnr      || '');
  t = rv(t, 'programa',           res.programa || '');
  t = rv(t, 'milhas',             res.milhas   || '');
  t = rv(t, 'pax',                res.pax      || '');
  // ida
  t = rv(t, 'data_ida',           fmtDateBR(res.dataIda));
  t = rv(t, 'hora_partida',       res.horaPartida  || '');
  t = rv(t, 'hora_chegada',       res.horaChegada  || '');
  t = rv(t, 'nvoo_ida',           res.nvooIda      || '');
  t = rv(t, 'cia',                res.ciaIda || res.cia || '');
  // volta
  t = rv(t, 'data_volta',         fmtDateBR(res.dataVolta));
  t = rv(t, 'hora_partida_volta', res.horaPartidaVolta  || '');
  t = rv(t, 'hora_chegada_volta', res.horaChegadaVolta  || '');
  t = rv(t, 'nvoo_volta',         res.nvooVolta         || '');
  t = rv(t, 'cia_volta',          res.ciaVolta          || '');
  t = rv(t, 'origem_volta',       res.origemVolta  || res.destino  || '');
  t = rv(t, 'destino_volta',      res.destinoVolta || res.origem   || '');
  return t;
}

// ── leitura/escrita via GitHub API ───────────────────────────────────────────
async function githubGet(path) {
  const r = await fetch(`${API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
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

// ── clientes via Apps Script (mesmo endpoint do concierge) ───────────────────
async function carregarClientes() {
  // Lê cfg.json para pegar a URL do Apps Script
  const { data: cfg } = await githubGet('cfg.json');
  if (!cfg.url) { console.log('[clientes] URL do Apps Script não configurada, pulando.'); return []; }

  const url = `${cfg.url}?aba=${encodeURIComponent(cfg.aba || 'Respostas ao formulário 1')}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apps Script → ${r.status}`);
  const rows = await r.json();

  const colIdx = col => col ? col.toUpperCase().charCodeAt(0) - 65 : -1;
  const c = cfg;
  return rows.slice(1).map(row => ({
    nome:   String(row[colIdx(c.colNome || 'C')] || '').trim(),
    tel:    String(row[colIdx(c.colTel  || 'D')] || '').trim(),
    email:  String(row[colIdx(c.colEmail|| 'E')] || '').trim(),
    cpf:    String(row[colIdx(c.colCpf  || 'F')] || '').trim(),
    nasc:   String(row[colIdx(c.colNasc || 'H')] || '').trim(),
    cidade: String(row[colIdx(c.colCidade||'O')] || '').trim(),
    grupo:  String(row[colIdx(c.colGrupo|| 'B')] || '').trim(),
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

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[lembrete-voo] Iniciando — ${new Date().toLocaleString('pt-BR', {timeZone: TZ_SP})}`);

  if (!GITHUB_TOKEN) { console.error('❌ CDV_GITHUB_TOKEN não definido'); process.exit(1); }

  // 1. Carregar dados
  const [reservasResp, modelosResp, clientes] = await Promise.all([
    githubGet('reservas.json'),
    githubGet('modelos.json'),
    carregarClientes().catch(e => { console.warn('[clientes]', e.message); return []; })
  ]);

  const reservas = reservasResp.data;
  const modelos  = modelosResp.data;

  // 2. Modelos de lembrete
  const modIda   = modelos.find(m => m.tipo === 'lembrete_ida');
  const modVolta = modelos.find(m => m.tipo === 'lembrete_volta');

  if (!modIda && !modVolta) {
    console.log('[lembrete-voo] Nenhum modelo de lembrete cadastrado. Crie um modelo com tipo "lembrete_ida" ou "lembrete_volta" no concierge.');
    return;
  }

  console.log(`[lembrete-voo] Modelos: ida=${modIda?.nome||'—'}, volta=${modVolta?.nome||'—'}`);
  console.log(`[lembrete-voo] Reservas: ${reservas.length} | Clientes: ${clientes.length}`);

  // 3. Verificar cada reserva
  let alteracoes = 0;
  const resultados = [];

  for (const res of reservas) {
    if (res.tipo !== 'voo') continue;

    const cli = clientes.find(c => c.nome === res.cliente);
    if (!cli) {
      console.log(`[skip] Reserva ${res.id}: cliente "${res.cliente}" não encontrado na planilha`);
      continue;
    }
    if (!cli.grupo) {
      console.log(`[skip] Cliente "${cli.nome}" sem grupoWhatsApp cadastrado`);
      continue;
    }

    // — Lembrete de IDA —
    if (modIda && res.dataIda && !res.lembreteIdaEnviado) {
      const horas = horasAte(res.dataIda, res.horaPartida);
      console.log(`[ida] ${res.id} "${res.cliente}" ${res.dataIda} → ${horas.toFixed(1)}h`);
      if (horas > 0 && horas <= JANELA_HORAS) {
        try {
          const msg = interpolar(modIda.texto, cli, res, 'ida');
          await enviarWhatsApp(cli.grupo, msg);
          res.lembreteIdaEnviado = true;
          res.lembreteIdaEnviadoEm = new Date().toISOString();
          alteracoes++;
          resultados.push(`✅ Lembrete IDA → "${cli.nome}" (${res.dataIda})`);
          console.log(`✅ Lembrete ida enviado para ${cli.nome} — voo ${res.dataIda}`);
        } catch (e) {
          console.error(`❌ Falha ao enviar lembrete ida para ${cli.nome}:`, e.message);
          resultados.push(`❌ Erro lembrete IDA → "${cli.nome}": ${e.message}`);
        }
      }
    }

    // — Lembrete de VOLTA —
    if (modVolta && res.dataVolta && !res.lembreteVoltaEnviado) {
      const horas = horasAte(res.dataVolta, res.horaPartidaVolta);
      console.log(`[volta] ${res.id} "${res.cliente}" ${res.dataVolta} → ${horas.toFixed(1)}h`);
      if (horas > 0 && horas <= JANELA_HORAS) {
        try {
          const msg = interpolar(modVolta.texto, cli, res, 'volta');
          await enviarWhatsApp(cli.grupo, msg);
          res.lembreteVoltaEnviado = true;
          res.lembreteVoltaEnviadoEm = new Date().toISOString();
          alteracoes++;
          resultados.push(`✅ Lembrete VOLTA → "${cli.nome}" (${res.dataVolta})`);
          console.log(`✅ Lembrete volta enviado para ${cli.nome} — voo ${res.dataVolta}`);
        } catch (e) {
          console.error(`❌ Falha ao enviar lembrete volta para ${cli.nome}:`, e.message);
          resultados.push(`❌ Erro lembrete VOLTA → "${cli.nome}": ${e.message}`);
        }
      }
    }
  }

  // 4. Salvar reservas atualizadas (se houve envios)
  if (alteracoes > 0) {
    console.log(`[lembrete-voo] Salvando ${alteracoes} alteração(ões)…`);
    // Refetch SHA antes de salvar
    const { sha } = await githubGet('reservas.json');
    await githubPut(
      'reservas.json',
      reservas,
      sha,
      `chore: lembrete(s) de voo enviado(s) — ${new Date().toISOString().slice(0,16)}`
    );
    console.log('✅ reservas.json atualizado');
  } else {
    console.log('[lembrete-voo] Nenhum lembrete para enviar nesta execução.');
  }

  console.log('\n=== Resumo ===');
  resultados.forEach(r => console.log(r));
  if (!resultados.length) console.log('(nenhum envio)');
}

main().catch(e => { console.error('❌ Erro fatal:', e); process.exit(1); });
