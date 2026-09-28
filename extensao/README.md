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

Itens em vermelho = o cliente respondeu "não sei" ou algo que exige conversa (ex.: segurança). Itens com nota amarela pedem conferência (divisão de nome/sobrenome, linhas extras que precisam do "Add Another").

## Arquivos
- `manifest.json` — MV3; permissões só para `ceac.state.gov` e o proxy CDV.
- `mapa.js` — converte `registro.dados` do `ds160.html` em itens do DS-160. **Mudou pergunta no `ds160.html`? Ajuste aqui.**
- `content.js` — roda no site do consulado; só preenche o que o painel manda.
- `painel.html/css/js` — painel lateral (login, lista, preenchimento, tradução).
- `background.js` — abre o painel ao clicar no ícone.

Nenhum dado de cliente fica gravado no navegador: só o token de sessão, quais itens já foram preenchidos e as traduções da sessão.
