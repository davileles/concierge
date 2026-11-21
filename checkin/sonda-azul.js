// Sonda do check-in Azul em segundo plano (GitHub Actions, Chrome headless).
// Só responde "a Azul deixa um servidor abrir a reserva?". NÃO faz check-in,
// não clica em nada e não imprime dado de cliente: este repo e os logs do
// Actions são PÚBLICOS. Localizador, nomes e conteúdo da página nunca vão
// para o log; só sinais (status HTTP, título, marcadores de proteção).
const puppeteer = require('puppeteer');

const REPO  = process.env.CONCIERGE_DADOS_REPO || 'davileles/dados';
const TOKEN = process.env.CDV_GITHUB_TOKEN || '';
const RES_ID = (process.env.RESERVA_ID || '').trim();

async function reserva(id) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/concierge/reservas.json`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw' }
  });
  if (!r.ok) throw new Error('GitHub reservas.json → ' + r.status);
  const lista = await r.json();
  return (Array.isArray(lista) ? lista : lista.reservas || []).find(x => x.id === id);
}

(async () => {
  if (!TOKEN || !RES_ID) { console.log('faltou token ou RESERVA_ID'); process.exit(1); }
  const res = await reserva(RES_ID);
  if (!res || !res.pnr || !res.origem) { console.log('reserva não encontrada ou sem pnr/origem'); process.exit(1); }
  const pnr = String(res.pnr).split(/[,;/\s]/)[0].toUpperCase();
  const segredos = [pnr, ...String(res.cliente || '').split(/\s+/), ...(res.passageiros || []).join(' ').split(/\s+/)]
    .filter(s => s && s.length > 2).map(s => s.toUpperCase());
  const limpa = s => { let t = String(s || ''); segredos.forEach(x => { t = t.split(x).join('***').split(x.toLowerCase()).join('***'); }); return t; };

  const url = `https://www.voeazul.com.br/br/pt/home/minhas-viagens?pnr=${encodeURIComponent(pnr)}&origin=${encodeURIComponent(res.origem)}`;
  const navegador = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--lang=pt-BR'] });
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 1366, height: 900 });
  const apis = [];
  pg.on('response', r => {
    const u = r.url();
    if (/voeazul|azul/i.test(new URL(u).hostname) && /api|reserv|booking|checkin|pnr/i.test(u)) {
      apis.push(`${r.status()} ${r.request().method()} ${limpa(new URL(u).hostname + new URL(u).pathname)}`);
    }
  });
  let doc = null;
  try {
    const resp = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    doc = resp ? resp.status() : null;
  } catch (e) { console.log('navegação falhou:', e.message); }
  await new Promise(ok => setTimeout(ok, 20000));
  const sinais = await pg.evaluate(() => {
    const t = document.body ? document.body.innerText : '';
    return {
      titulo: document.title,
      temReserva: /Código da reserva/i.test(t),
      proximasViagens: (t.match(/Próximas viagens \((\d+)\)/) || [])[1] || null,
      botaoCheckin: /Fazer check-in/i.test(t),
      cartaoEmbarque: /cart[aã]o de embarque/i.test(t),
      carregando: /Carregando informa/i.test(t),
      captcha: /captcha|n[aã]o sou um rob[oô]|verify you are human|access denied|acesso negado|bloquead/i.test(t + document.documentElement.innerHTML.slice(0, 20000)),
      tamanhoTexto: t.length
    };
  }).catch(e => ({ erro: e.message }));
  console.log('HTTP do documento:', doc);
  console.log('Sinais:', JSON.stringify({ ...sinais, titulo: limpa(sinais.titulo) }));
  console.log('Chamadas de API da Azul (' + apis.length + '):');
  apis.slice(0, 40).forEach(a => console.log('  ' + a));
  const veredito = sinais.temReserva ? 'ENTROU — a reserva abriu no servidor'
    : sinais.captcha || doc === 403 ? 'BLOQUEADO — proteção anti-robô'
    : 'INDEFINIDO — a reserva não apareceu (ver sinais)';
  console.log('VEREDITO:', veredito);
  await navegador.close();
})().catch(e => { console.log('erro:', e.message); process.exit(1); });
