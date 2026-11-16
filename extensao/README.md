# Extensão DS-160 — Concierge Estratégico

Painel lateral do Chrome que preenche o DS-160 (ceac.state.gov) com as respostas que o cliente mandou pelo `ds160.html`.

## Instalar (uma vez)
1. Baixe o `.zip` da extensão e descompacte numa pasta que não vai apagar.
2. No Chrome, abra `chrome://extensions`, ligue **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta.
4. Fixe o ícone "DS" na barra do Chrome.

Para atualizar: substitua os arquivos da pasta e clique em ↻ no card da extensão em `chrome://extensions`.

## Usar
1. Abra o DS-160 em ceac.state.gov, passe pelo CAPTCHA e comece/recupere a aplicação.
2. Clique no ícone "DS": o painel abre ao lado. Entre com o e-mail do concierge (código de 6 dígitos).
3. Escolha o cliente. O bloco azul **"Página do DS-160"** mostra só as respostas da página aberta.
4. **Preencher** num item = aquele campo; **Preencher esta página** = todos. Os campos preenchidos ficam amarelos no site. Revise e clique em **Next** no site.
5. **🌐 Traduzir textos** passa as respostas livres (funções, curso, motivos) para o inglês via IA do proxy — revise antes de preencher.
6. **Modo manual (↘):** clique no campo do site e depois no ↘ do valor. Clique no valor para copiar.
7. No fim, **✓ Marcar como preenchido** atualiza o status no painel do concierge.

## Modo automático (▶ Preencher tudo até a revisão)
Com o DS-160 aberto na primeira página do formulário (depois do CAPTCHA e da pergunta de segurança), clique em **▶ Preencher tudo até a revisão**:
1. Traduz de uma vez os textos livres que ainda não estão em inglês.
2. Em cada página: preenche tudo o que o cliente respondeu, clica sozinho em **Add Another** quando precisa de mais uma linha (acompanhantes, escolas, redes, países) e clica em **Next** (o site salva a página).
3. Para e explica quando: o site aponta erro; falta algo que só dá para completar à mão (item vermelho, endereço que não separou, hotel sem nome/telefone, área de atuação não informada); um campo não foi encontrado; ou a página não tem respostas do cliente. Resolva no site e clique em **▶ Continuar** — ele clica em Next e segue.
4. Para na **revisão** (ou na foto). A conferência, a foto, a assinatura e o envio ficam com você.

O **Application ID** que aparece no topo do site fica salvo na extensão (só nesse navegador) e aparece abaixo do nome do cliente; clique para copiar.

Itens em vermelho = o cliente respondeu "não sei", faltou informação ou algo exige conversa (ex.: segurança). Itens com nota amarela pedem conferência (ex.: divisão de nome/sobrenome).

## Arquivos
- `manifest.json` — MV3; permissões só para `ceac.state.gov` e o proxy CDV.
- `mapa.js` — converte `registro.dados` do `ds160.html` em itens do DS-160. **Mudou pergunta no `ds160.html`? Ajuste aqui.**
- `content.js` — roda no site do consulado; só preenche o que o painel manda.
- `painel.html/css/js` — painel lateral (login, lista, preenchimento, tradução).
- `background.js` — abre o painel ao clicar no ícone.

Nenhum dado de cliente fica gravado no navegador: só o token de sessão, quais itens já foram preenchidos e as traduções da sessão.

## Inventário de campos (para manter o mapa em dia)
A cada página do DS-160 aberta (e a cada "Yes" que abre campos novos), a extensão anota sozinha os campos do site — id, tipo, rótulo e opções, **sem nenhum valor preenchido**. O botão **⬇ Baixar campos do site** gera o `ds160-campos.json`; com ele dá para conferir e corrigir os ids do `mapa.js`. Para um inventário completo, passe por todas as páginas, inclusive marcando "Yes" onde abre campos novos (pode desfazer depois).
