# 📄 Scanner de Documentos

App de digitalizar que roda direto no iPhone (e no Android). Vira PDF, envia por
WhatsApp/e-mail e salva as fotos no iCloud. **Funciona sem internet.**

---

## Como instalar no iPhone (2 minutos)

1. Coloque os arquivos num site com **https** (GitHub Pages, Netlify, Vercel —
   veja "Publicar" mais abaixo). É obrigatório: o iPhone só libera a câmera em
   endereços seguros, `http://` não funciona.
2. Abra o link no **Safari** do iPhone.
3. Toque no botão **Compartilhar** (o quadrado com a seta pra cima).
4. Escolha **Adicionar à Tela de Início**.
5. Pronto. O Scanner vira um app com ícone, abre em tela cheia e funciona offline.

O atalho para quem ainda não quiser instalar: na tela inicial do app, botão
**📱 Ver QR Code de acesso** — aponta a câmera do celular para ele e o site abre.

---

## O que ele faz

| Função | Como usar |
|---|---|
| Digitalizar com a câmera | Botão azul "Escanear com a câmera". Fotografe quantas folhas quiser — não tem limite. |
| Enquadrar automático | A câmera **procura a folha sozinha**: o guia se ajusta no papel, a borda fica verde quando trava no lugar e a foto sai **já recortada**. O botão ⌗ no topo liga e desliga. |
| Usar fotos do iCloud | "Importar fotos" → escolhe da nuvem ou do rolo da câmera, várias de uma vez. |
| Recortar automático | Remove a mesa e deixa só o papel. Usa o botão ✂. |
| Recorte manual | Botão ⛶: arraste os cantos com o dedo. |
| Girar página | Botão ⟳ (90° por toque). |
| Reordenar | Botões ◀ ▶ de cada página. |
| Reordenar todas de uma vez | Toque numa miniatura para a página em tamanho grande. |
| Melhorar a imagem | Automático (tira o amarelo), Cor, Tons de cinza ou Alto contraste. |
| Criar pastas | "📁 Nova pasta de documentos". Cada pasta é um documento separado (ex.: Contrato, Recibos, Trabalho). Nada se mistura. |
| Dar nome às folhas | Toque em **✎** na folha. Ex.: Capa, Cláusulas, Assinatura. Para várias de uma vez: **🔢 Nome em sequência**. |
| Enviar o PDF | **📄 PDF desta pasta**: 1 arquivo, nomeado com o nome da pasta. Melhor para um documento só. |
| Enviar vários | **✉️ Separado**: 1 PDF de cada pasta, todos na mesma mensagem do WhatsApp. O cliente só toca e abre. |
| Enviar tudo junto | **🗂 Tudo**: um `.zip` com uma pasta por documento. A pessoa abre e vê tudo arrumado. |
| Salvar as fotos no iCloud | Botão **☁️ Fotos**: uma por vez, e no menu do iPhone você toca em **Salvar Imagem**. |
| Guardar o PDF no iCloud | No menu de compartilhamento, escolha **Armazenar em Arquivos**. |
| Não perder trabalho | Salva sozinho no aparelho. Fechou o app? Voltou e está tudo lá, com as pastas e os nomes. |
| Escolher a cor | Botões no topo: **azul** ou **rosa**. Fica salvo para as próximas vezes. |

---

## Privacidade — leia isto

- **O código é seu, e é público.** Qualquer pessoa pode abrir, copiar e usar
  à vontade. Você não perde nada: no máximo alguém faz uma cópia do app.
- **Os documentos são de quem usa.** Tudo fica no aparelho da pessoa
  (IndexedDB / localStorage). Não existe servidor seu recebendo foto, PDF ou
  qualquer coisa. Você não vê os documentos dos outros — e eles não veem os seus.
- Se a pessoa limpar os dados do navegador, o que estava salvo some.
- Sem anúncios, sem rastreamento, sem conta, sem servidor.

---

## Publicar (qualquer pessoa pode, de graça)

### Opção A — GitHub Pages (já publicado)

O app já está no ar:

**https://marcelooliveira8052668-cyber.github.io/scanner-de-documentos/**

Repositório: https://github.com/marcelooliveira8052668-cyber/scanner-de-documentos

Para republicar depois de mexer no código:

```bash
cd scanner-pdf-iphone
git add -A
git commit -m "minha alteracao"
git push              # o GitHub Pages atualiza sozinho em ~1 minuto
```

O Pages está configurado para publicar a pasta inteira do repositório, direto
da branch `main` — não precisa de configuração extra.

Se quiser publicar em outro repositório seu, o caminho é:

```bash
gh repo create scanner-de-documentos --public --source=. --push
gh api -X POST repos/SEU-USUARIO/scanner-de-documentos/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

> O GitHub Pages pode rodar por Actions também. O arquivo está pronto em
> `tools/opcional/pages.yml` — se mover ele para `.github/workflows/`, ele
> assume a publicação. Só é preciso rodar `gh auth refresh -s workflow`
> uma vez para o GitHub autorizar.

### Opção B — Netlify Drop (arrastar e soltar, sem terminal)

1. Entre em <https://app.netlify.com/drop>
2. Arraste a pasta `scanner-pdf-iphone` para a página.
3. Pronto: já sai um endereço `https://algo.netlify.app`.

### Opção C — testar no computador

```bash
node tools/dev-server.mjs "." 8080
```

E abra <http://127.0.0.1:8080>. A câmera exige `localhost` ou https — por isso,
para testar a câmera de verdade, use uma das opções A ou B.

---

## Ajustes e qualidade

- **Rápido** (1600 px): arquivo leve, ideal para mandar por WhatsApp.
- **Boa** (2400 px): o equilíbrio certo. Padrão.
- **Máxima** (3200 px): melhor para texto miúdo ou documento antigo.

Tamanho da página no PDF: **A4**, **Carta** ou **Tamanho da foto** (não deforma).

---

## Estrutura

```
scanner-pdf-iphone/
├── index.html            interface
├── styles.css            visual e as duas cores (azul/rosa)
├── manifest.json         ícone e instalação na tela de início
├── sw.js                 service worker (offline e atualizações)
├── js/
│   ├── utils.js          utilidades (canvas, arquivos, avisos)
│   ├── filters.js        melhoria de imagem, detecção de bordas, enquadramento
│   ├── pdf.js            monta o PDF (sem bibliotecas externas)
│   ├── zip.js            monta o .zip (sem bibliotecas externas)
│   ├── db.js             salvamento automático no aparelho
│   ├── app.js            telas, câmera, pastas e folhas
│   └── vendor/qrcode.js  QR Code (MIT, Kazuhiko Arase)
├── icons/                ícones gerados por script
└── tools/
    ├── dev-server.mjs    servidor local para testar
    ├── gerar-icones.mjs  gera os PNGs do ícone
    ├── validar-pdf.mjs   confere se o PDF saiu bem
    └── opcional/         publicação por Actions (opcional)
```

O PDF e o .zip são montados à mão, sem nenhuma biblioteca externa — por isso
funcionam offline e os arquivos saem leves.

### Como o enquadramento automático funciona

1. A cada ~130 ms o app copia um pedacinho do vídeo (170 px de largura) para um canvas.
2. `detectarBordas()` aplica limiar de Otsu e procura o maior bloco claro — que é o papel.
3. O retângulo é mapeado para a imagem cheia, desenhado no guia (com o resto escurecido) e
   estável quando a folha não se moveu entre leituras.
4. Ao apertar o botão, a foto é recortada nesse retângulo antes de virar folha.

### Por que o WhatsApp não recebe "pastas"

O WhatsApp trabalha com **arquivos**, não com pastas. Por isso o app nunca manda
folha por folha: ele manda **um PDF por documento** (nomeado com o nome da pasta).
Se quiser levar tudo em um único item, o botão **🗂 Tudo** gera um `.zip` com uma
subpasta por documento — que é o mais perto de "mandar uma pastinha" que dá, e
abre nativamente no iPhone e no Android.

### Por que os arquivos têm `?v=4` no endereço

O `?v=4` no `index.html` é o que garante que quem já instalou o app na tela de
início receba as atualizações. Sem isso, o navegador guardaria a versão antiga
em cache e a pessoa continuaria vendo um app desatualizado. Ao publicar uma
mudança, troque o `4` por `5` no `index.html` e no `sw.js`.

---

## Permissões

O app pede **uma** permissão: a câmera. E só quando você toca no botão de
escanear. Nada mais.

---

## Se algo der errado

**A câmera não abre.** Confira se o endereço começa com `https://`. É o caso mais comum.

**O PDF não abre.** Rode `node tools/validar-pdf.mjs arquivo.pdf` — ele diz o que está errado.

**O iPhone ficou lento com muitas folhas.** Troque a qualidade para "Rápido" na tela inicial.

**Quero trocar cores ou textos.** `styles.css` (topo do arquivo) e `index.html`. Ícone: `node tools/gerar-icones.mjs`.

**Não quero mais usar.** Apague o repositório. Quem já instalou continua usando a cópia que tem no aparelho — apps da tela de início não dependem mais do site.