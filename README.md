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
| Usar fotos do iCloud | "Importar fotos" → escolhe da nuvem ou do rolo da câmera, várias de uma vez. |
| Recortar automático | Remove a mesa e deixa só o papel. Usa o botão ✂. |
| Recorte manual | Botão ⛶: arraste os cantos com o dedo. |
| Girar página | Botão ⟳ (90° por toque). |
| Reordenar | Botões ◀ ▶ de cada página. |
| Reordenar todas de uma vez | Toque numa miniatura para a página em tamanho grande. |
| Melhorar a imagem | Automático (tira o amarelo), Cor, Tons de cinza ou Alto contraste. |
| Gerar PDF | "Gerar e enviar PDF": sai o arquivo pronto para mandar. |
| Salvar as fotos no iCloud | Botão "☁️ Fotos": uma por vez, e no menu do iPhone você toca em **Salvar Imagem**. |
| Guardar o PDF no iCloud | No menu de compartilhamento, escolha **Armazenar em Arquivos**. |
| Não perder trabalho | Salva sozinho no aparelho. Fechou o app? Voltou e está tudo lá. |

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

### Opção A — GitHub Pages (com o GitHub CLI instalado)

```bash
cd scanner-pdf-iphone
git init
gh repo create scanner-de-documentos --public --source=. --push
sleep 5
gh api -X POST repos/:owner/:repo/pages -f source[branch]=main -f source[path]=/ >/dev/null
```

O endereço fica em `Settings → Pages` no repositório. Como o repositório é
público, o link é:

```
https://SEU-USUARIO.github.io/scanner-de-documentos/
```

Atualizei o app com GitHub Actions (`.github/workflows/pages.yml`), então
qualquer `git push` publica sozinho. O passo do `gh api` só é preciso na
primeira publicação.

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
├── styles.css            visual
├── manifest.json         ícone e instalação na tela de início
├── sw.js                 service worker (funcionamento offline)
├── js/
│   ├── utils.js          utilidades (canvas, arquivos, avisos)
│   ├── filters.js        melhoria de imagem e detecção de bordas
│   ├── pdf.js            monta o PDF (sem bibliotecas externas)
│   ├── db.js             salvamento automático no aparelho
│   ├── app.js            telas, câmera, lista de páginas
│   └── vendor/qrcode.js  QR Code (MIT, Kazuhiko Arase)
├── icons/                ícones gerados por script
└── tools/
    ├── dev-server.mjs    servidor local para testar
    ├── gerar-icones.mjs  gera os PNGs do ícone
    └── validar-pdf.mjs   confere se o PDF saiu bem
```

O PDF é montado à mão, sem nenhuma biblioteca externa — por isso funciona
offline e o arquivo sai leve.

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