/* =========================================================
   app.js — Scanner de Documentos
   ========================================================= */
'use strict';

const App = {
  paginas: [],                 // { id, original, filtro, rotacao, url, largura, altura }
  qualidade: 2400,
  filtro: 'auto',
  modoPagina: 'a4',
  stream: null,
  torch: false,
  paginaAtualModal: null
};

/* =========================================================
   Navegação entre telas
   ========================================================= */
function irPara(nome) {
  $$('.tela').forEach(t => t.classList.remove('ativa'));
  const alvo = $(`#tela-${nome}`);
  alvo.classList.add('ativa');
  if (nome === 'editor') renderEditor();
  if (nome !== 'camera') pararCamera();
}

function paginasCount() {
  const n = App.paginas.length;
  $('#contador').textContent = n + (n === 1 ? ' página' : ' páginas');
  if (n > 1) {
    // páginas com rotação virada sãoWide; avisa quando o doc já é grande
    const peso = App.paginas.reduce((s, p) => s + p.largura * p.altura, 0);
    if (n >= 50 || peso > 260e6) {
      $('#aviso-grande').hidden = false;
    } else {
      $('#aviso-grande').hidden = true;
    }
  } else {
    $('#aviso-grande').hidden = true;
  }
}

/* =========================================================
   Modelo de página
   ========================================================= */
function criarPagina(canvasOriginal) {
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    original: canvasOriginal,                 // canvas sem filtro nem rotação
    filtro: App.filtro,
    rotacao: 0,
    url: null,                                // preenchido no render
    largura: canvasOriginal.width,
    altura: canvasOriginal.height,
    async canvasBase() {                      // original + filtro atual
      return aplicarFiltro(this.original, this.filtro);
    },
    async canvasFinal() {                     // + rotação
      return rotacionarCanvas(await this.canvasBase(), this.rotacao);
    },
    descartar() { if (this.url) URL.revokeObjectURL(this.url); }
  };
}

function acharPagina(id) {
  return App.paginas.find(p => p.id === id);
}

async function urlDaPagina(pagina) {
  if (!pagina.url) {
    const blob = await canvasParaBlob(await pagina.canvasFinal(), 'image/jpeg', 0.82);
    pagina.url = URL.createObjectURL(blob);
  }
  return pagina.url;
}

function invalidarUrl(pagina) {
  if (pagina.url) { URL.revokeObjectURL(pagina.url); pagina.url = null; }
}

/**
 * Adiciona uma página a partir de um canvas já pronto.
 * Nenhum limite de quantidade: o app aceita documentos de 1 ou de centenas de folhas.
 */
async function adicionarPagina(canvas) {
  const pagina = criarPagina(canvas);
  App.paginas.push(pagina);
  paginasCount();
  agendarSalvamento();
  return pagina;
}

/* =========================================================
   Ajustes (qualidade, filtro, tamanho da página)
   ========================================================= */
function ligarChips(seletor, callback) {
  const grupo = $(seletor);
  grupo.addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    $$('.chip', grupo).forEach(c => c.classList.remove('ativo'));
    chip.classList.add('ativo');
    callback(chip);
  });
}

const DICAS = {
  qualidade: {
    1600: 'Arquivos menores, bom para mandar por WhatsApp.',
    2400: 'Bom equilíbrio entre nitidez e tamanho do arquivo.',
    3200: 'Máxima nitidez (texto pequeno). Arquivos maiores.'
  },
  filtro: {
    auto: 'Tira o tom amarelado e deixa o papel bem branco.',
    color: 'Mantém as cores, com um leve ganho de contraste.',
    gray: 'Documento em tons de cinza: menor e mais legível.',
    contrast: 'Máximo contraste. Ideal para textos pequenos ou pennycents.'
  }
};

/* =========================================================
   Importar fotos do iCloud / Arquivos
   ========================================================= */
async function importarArquivos(arquivos) {
  if (!arquivos || !arquivos.length) return;
  await comCarregando(`Lendo ${arquivos.length} foto(s)…`, async () => {
    for (const arq of arquivos) {
      if (!arq.type.startsWith('image/')) continue;
      try {
        const img = await carregarImagem(arq);
        await adicionarPagina(canvasLimitado(img, App.qualidade));
      } catch (e) {
        aviso('Não consegui ler uma das fotos.');
      }
    }
  });
  irPara('editor');
}

/* =========================================================
   Câmera
   ========================================================= */
async function abrirCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    aviso('Este navegador não permite usar a câmera. Use o Safari no iPhone.');
    return;
  }
  irPara('camera');
  try {
    App.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1920 }
      },
      audio: false
    });
    const video = $('#video');
    video.srcObject = App.stream;
    await video.play();
    await video.play().catch(() => {});
    verificarLanterna();
  } catch (e) {
    aviso('Não consegui acessar a câmera. Autorize o acesso nas configurações do site.', 4200);
    irPara('home');
  }
}

function verificarLanterna() {
  const track = App.stream && App.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $('#btn-flash').hidden = !('torch' in caps);
}

function pararCamera() {
  if (App.stream) {
    App.stream.getTracks().forEach(t => t.stop());
    App.stream = null;
  }
  $('#video').srcObject = null;
  App.torch = false;
  $('#btn-flash').style.opacity = '';
}

async function alternarLanterna() {
  const track = App.stream && App.stream.getVideoTracks()[0];
  if (!track) return;
  App.torch = !App.torch;
  try {
    await track.applyConstraints({ advanced: [{ torch: App.torch }] });
    $('#btn-flash').style.opacity = App.torch ? '1' : '';
  } catch (e) {
    App.torch = false;
    aviso('A lanterna não está disponível agora.');
  }
}

/** Captura o quadro atual do vídeo e adiciona como nova página. */
async function capturar() {
  const video = $('#video');
  if (!video.videoWidth) { aviso('Aguarde a câmera abrir.'); return; }

  const flash = $('#flash');
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 130);

  await comCarregando('Processando página…', async () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    const bruto = novoCanvas(vw, vh);
    bruto.getContext('2d').drawImage(video, 0, 0, vw, vh);

    // No iPhone a câmera traseira pode entregar o quadro "deitado":
    // se a proporção do vídeo na tela for diferente da do quadro, é preciso girar.
    const tela = video.getBoundingClientRect();
    const quadroDeitado = vw > vh;
    const telaEmPe = tela.height > tela.width;
    let canvas = bruto;
    if (quadroDeitado && telaEmPe) canvas = rotacionarCanvas(bruto, 90);
    canvas = canvasLimitado(canvas, App.qualidade);
    await adicionarPagina(canvas);
  });

  paginasCount();
  aviso('Página adicionada ✓');
}

/* =========================================================
   Editor: lista de páginas
   ========================================================= */
/** Desenha o cartão de uma página na lista. */
function cartaoPagina(p, i, total) {
  const card = document.createElement('div');
  card.className = 'pagina';
  card.innerHTML = `
    <div class="mini"><img alt="Página ${i + 1}"></div>
    <div class="info">
      <div class="num">Página ${i + 1} <small>${p.largura}×${p.altura}</small></div>
      <div class="grade-botoes">
        <button class="mini-btn" data-a="girar">⟳</button>
        <button class="mini-btn" data-a="auto">✂</button>
        <button class="mini-btn" data-a="recortar">⛶</button>
        <button class="mini-btn perigo" data-a="excluir">🗑</button>
      </div>
      <div class="mover-linha">
        <button class="mini-btn" data-a="ant" ${i === 0 ? 'disabled' : ''}>◀</button>
        <button class="mini-btn" data-a="prox" ${i === total - 1 ? 'disabled' : ''}>▶</button>
      </div>
    </div>`;
  card.querySelector('.mini').addEventListener('click', () => abrirModalPagina(p.id));
  card.addEventListener('click', ev => {
    const btn = ev.target.closest('.mini-btn');
    if (!btn || btn.disabled) return;
    acaoPagina(p.id, btn.dataset.a);
  });
  return card;
}

/**
 * Lista as páginas mostrando no máximo 60 por vez (miniaturas em memória são caras).
 * Documentos grandes continuam inteiros: a lista só deixa de mostrar até você pedir mais.
 */
const PAGINAS_POR_VEZ = 60;
let quantasMostradas = PAGINAS_POR_VEZ;

async function renderEditor() {
  const lista = $('#lista-paginas');
  lista.innerHTML = '';
  $('#editor-vazio').hidden = App.paginas.length > 0;
  $('#editor-titulo').textContent = App.paginas.length
    ? `${App.paginas.length} página${App.paginas.length > 1 ? 's' : ''}`
    : 'Minhas páginas';
  atualizarBotaoFiltro();

  const total = App.paginas.length;
  const limite = Math.min(total, quantasMostradas);

  for (let i = 0; i < limite; i++) {
    const p = App.paginas[i];
    const card = cartaoPagina(p, i, total);
    lista.appendChild(card);
    urlDaPagina(p).then(url => {
      const img = card.querySelector('.mini img');
      if (img) img.src = url;
    });
    if (i % 8 === 7) await new Promise(r => setTimeout(r));  // respira a interface
  }

  if (limite < total) {
    const mais = document.createElement('button');
    mais.className = 'btn-linha';
    mais.textContent = `Mostrar mais ${Math.min(PAGINAS_POR_VEZ, total - limite)} páginas (de ${total})`;
    mais.addEventListener('click', () => {
      quantasMostradas += PAGINAS_POR_VEZ;
      renderEditor();
    });
    lista.appendChild(mais);
  }
}

function moverPagina(id, dir) {
  const i = App.paginas.findIndex(p => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= App.paginas.length) return;
  [App.paginas[i], App.paginas[j]] = [App.paginas[j], App.paginas[i]];
  renderEditor();
}

async function acaoPagina(id, acao) {
  const p = acharPagina(id);
  if (!p) return;
  const i = App.paginas.indexOf(p);

  switch (acao) {
    case 'girar':
      p.rotacao = (p.rotacao + 90) % 360;
      invalidarUrl(p);
      renderEditor();
      agendarSalvamento();
      break;

    case 'ant':
      moverPagina(id, -1);
      break;
    case 'prox':
      moverPagina(id, 1);
      break;

    case 'excluir':
      p.descartar();
      App.paginas.splice(i, 1);
      renderEditor();
      agendarSalvamento();
      break;

    case 'recortar':
      abrirModalRecorte(id);
      break;

    case 'auto':
      await recorteAutomatico([p]);
      renderEditor();
      agendarSalvamento();
      break;

    case 'imagem':
      await compartilharImagemDaPagina(p, i);
      break;
  }
}

/* =========================================================
   Salvamento automático (tudo fica no aparelho da pessoa)
   ========================================================= */
let timerSalvar = null;

function mostrarStatus(texto, salvando) {
  const el = $('#status-salvamento');
  if (!texto) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = texto;
  el.classList.toggle('salvando', !!salvando);
}

function agendarSalvamento() {
  if (!App.paginas.length) {
    clearTimeout(timerSalvar);
    mostrarStatus('', false);
    DB.limparSessao();
    return;
  }
  mostrarStatus('⏳ Salvando no aparelho…', true);
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(salvarSessao, 900);
}

async function salvarSessao() {
  try {
    const itens = [];
    for (const p of App.paginas) {
      const blob = await canvasParaBlob(p.original, 'image/jpeg', 0.86);
      itens.push({ blob, largura: p.largura, altura: p.altura, rotacao: p.rotacao, filtro: p.filtro });
    }
    await DB.salvarSessao({
      versao: 1,
      quando: Date.now(),
      qualidade: App.qualidade,
      filtro: App.filtro,
      modoPagina: App.modoPagina,
      paginas: itens
    });
    const info = await DB.espaco();
    const uso = info && info.usage ? ` · ${(info.usage / 1048576).toFixed(1)} MB usados` : '';
    mostrarStatus('💾 Salvo no aparelho' + uso, false);
  } catch (e) {
    mostrarStatus('⚠️ Não consegui salvar neste aparelho', false);
  }
}

async function restaurarSessao() {
  let dados;
  try { dados = await DB.lerSessao(); } catch { return false; }
  if (!dados || !Array.isArray(dados.paginas) || !dados.paginas.length) return false;

  await comCarregando('Recuperando seu trabalho…', async () => {
    for (const it of dados.paginas) {
      if (!it.blob) continue;
      try {
        const img = await carregarImagem(it.blob);
        const c = novoCanvas(it.largura || img.naturalWidth, it.altura || img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const p = criarPagina(c);
        p.rotacao = it.rotacao || 0;
        p.filtro = it.filtro || App.filtro;
        App.paginas.push(p);
      } catch { /* pula página corrompida */ }
    }
  });

  if (!App.paginas.length) return false;
  paginasCount();
  irPara('editor');
  aviso(`Recuperei ${App.paginas.length} página(s) da sua última sessão.`, 3600);
  return true;
}

function limparTudo() {
  if (!App.paginas.length) return;
  if (!confirm('Apagar todas as páginas? (some do aparelho)')) return;
  App.paginas.forEach(p => p.descartar());
  App.paginas = [];
  paginasCount();
  clearTimeout(timerSalvar);
  DB.limparSessao();
  mostrarStatus('', false);
  renderEditor();
}

async function recorteAutomatico(lista) {
  await comCarregando('Detectando as bordas…', async () => {
    let ok = 0;
    for (const p of lista) {
      const base = await loadImageFromCanvas(p.original);
      const det = detectarBordas(base);
      if (det) {
        p.original = recortarCanvas(base, det);
        base.width = 1; base.height = 1;
        p.largura = p.original.width;
        p.altura = p.original.height;
        p.rotacao = 0;
        invalidarUrl(p);
        ok++;
      } else {
        base.width = 1; base.height = 1;
      }
    }
    aviso(ok ? `Bordas ajustadas em ${ok} página(s).` : 'Não encontrei as bordas — use o recorte manual.', 3600);
  });
}

/* =========================================================
   Modal da página (ações grandes)
   ========================================================= */
function abrirModalPagina(id) {
  App.paginaAtualModal = id;
  const p = acharPagina(id);
  if (!p) return;
  const i = App.paginas.indexOf(p);
  $('#pagina-titulo').textContent = `Página ${i + 1}`;
  $('#img-pagina-modal').src = p.url;
  $('#modal-pagina').hidden = false;
}

function fecharModalPagina() {
  $('#modal-pagina').hidden = true;
  App.paginaAtualModal = null;
}

/* =========================================================
   Compartilhar uma página como imagem (iCloud Fotos)
   ========================================================= */
async function compartilharImagemDaPagina(pagina, indice) {
  await comCarregando('Preparando a imagem…', async () => {
    const blob = await canvasParaBlob(await pagina.canvasFinal(), 'image/jpeg', 0.92);
    const nome = nomeComData(`Pagina-${indice + 1}`, 'jpg');
    await compartilharArquivo(blob, nome, `Página ${indice + 1}`);
  });
  if (ehApple()) aviso('No menu de compartilhamento escolha “Salvar Imagem” para ir ao iCloud Fotos.', 4200);
}

function abrirFluxoFotos() {
  const alvo = $('#passos-fotos');
  alvo.innerHTML = '';
  App.paginas.forEach((p, i) => {
    urlDaPagina(p).then(url => {
      const div = document.createElement('div');
      div.className = 'passo';
      div.innerHTML = `
        <img src="${url}" alt="Página ${i + 1}">
        <div class="n"><b>Página ${i + 1}</b><small>Toque em enviar e depois em “Salvar Imagem”.</small></div>
        <button class="mini-btn" data-i="${i}">Enviar</button>`;
      div.querySelector('button').addEventListener('click', async ev => {
        ev.stopPropagation();
        const idx = Number(ev.target.dataset.i);
        await compartilharImagemDaPagina(App.paginas[idx], idx);
        div.classList.add('feito');
      });
      alvo.appendChild(div);
    });
  });
  $('#modal-fotos').hidden = false;
}

/* =========================================================
   Modal de recorte manual
   ========================================================= */
const Recorte = { id: null, img: null, escala: 1, offX: 0, offY: 0, dispW: 0, dispH: 0, x: 0, y: 0, w: 0, h: 0, proporcao: 0 };

async function abrirModalRecorte(id) {
  const p = acharPagina(id);
  if (!p) return;
  fecharModalPagina();
  Recorte.id = id;
  // sempre a imagem original: o recorte e os filtros não podem se accumulating
  Recorte.img = await loadImageFromCanvas(p.original);
  const imgEl = $('#img-recorte');
  imgEl.src = await urlDaPagina(p);
  $('#modal-recorte').hidden = false;

  // espera o navegador posicionar a imagem
  requestAnimationFrame(() => {
    const area = $('#area-recorte');
    const r = area.getBoundingClientRect();
    const esc = Math.min(r.width / Recorte.img.width, r.height / Recorte.img.height);
    Recorte.escala = esc;
    Recorte.dispW = Recorte.img.width * esc;
    Recorte.dispH = Recorte.img.height * esc;
    Recorte.offX = (r.width - Recorte.dispW) / 2;
    Recorte.offY = (r.height - Recorte.dispH) / 2;
    imgEl.style.width = Recorte.dispW + 'px';
    imgEl.style.height = Recorte.dispH + 'px';
    imgEl.style.position = 'absolute';
    imgEl.style.left = Recorte.offX + 'px';
    imgEl.style.top = Recorte.offY + 'px';
    definirCaixa({ x: 0, y: 0, w: Recorte.img.width, h: Recorte.img.height });
  });
}

function definirCaixa(rectPx) {
  Recorte.x = clamp(rectPx.x, 0, Recorte.img.width);
  Recorte.y = clamp(rectPx.y, 0, Recorte.img.height);
  Recorte.w = clamp(rectPx.w, 16, Recorte.img.width - Recorte.x);
  Recorte.h = clamp(rectPx.h, 16, Recorte.img.height - Recorte.y);

  const s = Recorte.escala;
  const caixa = $('#caixa-recorte');
  caixa.style.left = (Recorte.offX + Recorte.x * s) + 'px';
  caixa.style.top = (Recorte.offY + Recorte.y * s) + 'px';
  caixa.style.width = (Recorte.w * s) + 'px';
  caixa.style.height = (Recorte.h * s) + 'px';
}

const PROPORCOES = { a4: 1 / 1.414, carta: 1 / 1.294, 11: 1, 34: 3 / 4, 43: 4 / 3, livre: 0 };

function aplicarProporcao(tipo) {
  Recorte.proporcao = PROPORCOES[tipo] || 0;
  if (!Recorte.proporcao) return;
  const cx = Recorte.x + Recorte.w / 2;
  const cy = Recorte.y + Recorte.h / 2;
  let w = Recorte.w, h = w / Recorte.proporcao;
  if (h > Recorte.img.height) { h = Recorte.img.height; w = h * Recorte.proporcao; }
  definirCaixa({ x: cx - w / 2, y: cy - h / 2, w, h });
}

function ligarGestosRecorte() {
  const caixa = $('#caixa-recorte');
  const area = $('#area-recorte');

  const paraImagem = (ev) => {
    const r = area.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - Recorte.offX) / Recorte.escala,
      y: (ev.clientY - r.top - Recorte.offY) / Recorte.escala
    };
  };

  // arrastar a caixa
  caixa.addEventListener('pointerdown', ev => {
    if (ev.target.classList.contains('alca')) return;
    ev.preventDefault();
    const inicio = paraImagem(ev);
    const base = { x: Recorte.x, y: Recorte.y };
    caixa.setPointerCapture(ev.pointerId);
    const mover = e => {
      definirCaixa({ x: base.x + (paraImagem(e).x - inicio.x), y: base.y + (paraImagem(e).y - inicio.y), w: Recorte.w, h: Recorte.h });
    };
    const soltar = () => {
      caixa.removeEventListener('pointermove', mover);
      caixa.removeEventListener('pointerup', soltar);
      caixa.removeEventListener('pointercancel', soltar);
    };
    caixa.addEventListener('pointermove', mover);
    caixa.addEventListener('pointerup', soltar);
    caixa.addEventListener('pointercancel', soltar);
  });

  // redimensionar pelas alças
  $$('.alca', caixa).forEach(alca => {
    alca.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const inicio = paraImagem(ev);
      const base = { x: Recorte.x, y: Recorte.y, w: Recorte.w, h: Recorte.h };
      const idx = ['h1', 'h2', 'h3', 'h4'].indexOf(alca.classList[1]);
      alca.setPointerCapture(ev.pointerId);
      const mover = e => {
        const pt = paraImagem(e);
        const dx = pt.x - inicio.x, dy = pt.y - inicio.y;
        let x = base.x, y = base.y, w = base.w, h = base.h;
        if (idx === 0 || idx === 3) { x = base.x + dx; w = base.w - dx; }
        if (idx === 1 || idx === 2) { w = base.w + dx; }
        if (idx === 0 || idx === 1) { y = base.y + dy; h = base.h - dy; }
        if (idx === 2 || idx === 3) { h = base.h + dy; }
        if (w < 24) w = 24;
        if (h < 24) h = 24;
        if (Recorte.proporcao) h = w / Recorte.proporcao;
        definirCaixa({ x, y, w, h });
      };
      const soltar = () => {
        alca.removeEventListener('pointermove', mover);
        alca.removeEventListener('pointerup', soltar);
        alca.removeEventListener('pointercancel', soltar);
      };
      alca.addEventListener('pointermove', mover);
      alca.addEventListener('pointerup', soltar);
      alca.addEventListener('pointercancel', soltar);
    });
  });

  // toque fora da caixa = desenhar nova caixa
  area.addEventListener('pointerdown', ev => {
    if (ev.target !== area && ev.target.id !== 'img-recorte') return;
    ev.preventDefault();
    const inicio = paraImagem(ev);
    const tamanho = 90;
    const desenhar = e => {
      const pt = paraImagem(e);
      const x = Math.min(inicio.x, pt.x);
      const y = Math.min(inicio.y, pt.y);
      const w = Math.abs(pt.x - inicio.x);
      const h = Math.abs(pt.y - inicio.y);
      if (w < 8 && h < 8) return;
      definirCaixa({ x, y, w: Math.max(w, tamanho), h: Math.max(h, tamanho) });
    };
    const soltar = () => {
      area.removeEventListener('pointermove', desenhar);
      area.removeEventListener('pointerup', soltar);
      area.removeEventListener('pointercancel', soltar);
    };
    area.addEventListener('pointermove', desenhar);
    area.addEventListener('pointerup', soltar);
    area.addEventListener('pointercancel', soltar);
  });
}

async function confirmarRecorte() {
  const p = acharPagina(Recorte.id);
  $('#modal-recorte').hidden = true;
  if (!p) return;
  await comCarregando('Recortando…', async () => {
    // recorta a imagem ORIGINAL (sem filtro), não a já tratada:
    // assim o filtro continua sendo aplicado uma única vez, sem escurecer a página
    const base = await loadImageFromCanvas(p.original);
    p.original = recortarCanvas(base, { x: Recorte.x, y: Recorte.y, w: Recorte.w, h: Recorte.h });
    base.width = 1; base.height = 1;
    p.largura = p.original.width;
    p.altura = p.original.height;
    invalidarUrl(p);
  });
  renderEditor();
  agendarSalvamento();
}

/** Converte um canvas em <img> para poder recortar dele com segurança. */
function loadImageFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('falha ao preparar o recorte'));
    img.src = canvas.toDataURL('image/jpeg', 0.95);
  });
}

/* =========================================================
   Gerar e enviar o PDF
   ========================================================= */
async function gerarPDF() {
  if (!App.paginas.length) { aviso('Adicione pelo menos uma página.'); return; }

  const total = App.paginas.length;
  const nome = nomeComData('Documento', 'pdf');

  // processa em blocos, com progresso visível e liberando memória entre blocos
  carregando(true, `Preparando página 1 de ${total}…`);
  await new Promise(r => setTimeout(r, 30));

  const itens = [];
  const inicio = Date.now();

  try {
    for (let i = 0; i < total; i++) {
      const p = App.paginas[i];
      const canvas = await p.canvasBase();
      const jpeg = await canvasParaBlob(canvas, 'image/jpeg', 0.88);
      itens.push({
        bytes: new Uint8Array(await jpeg.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
        rotation: p.rotacao
      });
      $('#carregando-txt').textContent = `Preparando página ${i + 1} de ${total}…`;

      // a cada 15 páginas: descarta os canvases e recua as miniaturas
      if (i % 15 === 14) {
        if (typeof canvas.width === 'number') { canvas.width = 1; canvas.height = 1; }
        await new Promise(r => setTimeout(r));
      }
    }

    carregando(true, `Montando o PDF de ${total} página(s)…`);
    await new Promise(r => setTimeout(r));
    const blob = montarPDF(itens, { modo: App.modoPagina, titulo: 'Documento digitalizado' });
    itens.length = 0;

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    const mb = (blob.size / 1048576).toFixed(1);
    await compartilharArquivo(blob, nome, 'Documento digitalizado');

    if (ehApple()) {
      aviso(`PDF de ${total} página(s), ${mb} MB, pronto em ${segundos}s. Para guardar no iCloud: “Armazenar em Arquivos”.`, 5000);
    } else {
      aviso(`PDF de ${total} página(s) criado (${mb} MB).`, 4000);
    }
  } catch (e) {
    aviso('Erro ao montar o PDF: ' + (e && e.message ? e.message : 'tente novamente'));
  } finally {
    carregando(false);
  }
}

/* =========================================================
   QR Code de acesso
   ========================================================= */
function urlDoApp() {
  // mesma página em que o app está rodando, sem parâmetros
  return location.origin + location.pathname;
}

function montarQR(texto) {
  const alvo = $('#qr-caixa');
  alvo.innerHTML = '';
  if (typeof qrcode !== 'function') {
    alvo.textContent = 'Biblioteca de QR Code não carregou.';
    return;
  }
  const qr = qrcode(0, 'M');            // versão automática, correção média
  qr.addData(texto);
  qr.make();

  const modulos = qr.getModuleCount();
  const m = 2;                           // margem branca
  const total = modulos + m * 2;
  let caminho = '';
  for (let linha = 0; linha < modulos; linha++) {
    for (let col = 0; col < modulos; col++) {
      if (qr.isDark(linha, col)) caminho += `M${col + m} ${linha + m}h1v1h-1z`;
    }
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR Code de acesso ao app');
  const fundo = document.createElementNS(NS, 'rect');
  fundo.setAttribute('width', total);
  fundo.setAttribute('height', total);
  fundo.setAttribute('fill', '#ffffff');
  const tracos = document.createElementNS(NS, 'path');
  tracos.setAttribute('d', caminho);
  tracos.setAttribute('fill', '#0b1220');
  svg.appendChild(fundo);
  svg.appendChild(tracos);
  alvo.appendChild(svg);

  $('#qr-url').textContent = texto;
}

function abrirQR() {
  const url = urlDoApp();
  montarQR(url);
  $('#modal-qr').hidden = false;
  return url;
}

/* =========================================================
   Inicialização
   ========================================================= */
function iniciar() {
  carregarPreferencias();

  ligarChips('#chips-qualidade', chip => {
    App.qualidade = Number(chip.dataset.q);
    $('#dica-qualidade').textContent = DICAS.qualidade[App.qualidade];
    CONFIG.gravar({ qualidade: App.qualidade });
  });
  ligarChips('#chips-filtro', chip => {
    App.filtro = chip.dataset.f;
    $('#dica-filtro').textContent = DICAS.filtro[App.filtro];
    CONFIG.gravar({ filtro: App.filtro });
    atualizarBotaoFiltro();
  });
  ligarChips('#chips-pagina', chip => {
    App.modoPagina = chip.dataset.p;
    CONFIG.gravar({ modoPagina: App.modoPagina });
  });
  ligarChips('#chips-proporcao', chip => aplicarProporcao(chip.dataset.r));

  $('#btn-aplicar-filtro').addEventListener('click', async () => {
    await comCarregando('Ajustando as páginas…', async () => {
      for (const p of App.paginas) {
        p.filtro = App.filtro;
        invalidarUrl(p);
      }
    });
    renderEditor();
    agendarSalvamento();
    aviso('Ajuste aplicado a todas as páginas.');
  });
  $('#btn-qr').addEventListener('click', abrirQR);
  $('#btn-qr-fechar').addEventListener('click', () => { $('#modal-qr').hidden = true; });
  $('#btn-copiar-url').addEventListener('click', async () => {
    const url = urlDoApp();
    try {
      await navigator.clipboard.writeText(url);
      aviso('Link copiado.');
    } catch { aviso(url); }
  });
  $('#btn-enviar-link').addEventListener('click', async () => {
    const url = urlDoApp();
    if (navigator.share) {
      try { await navigator.share({ title: 'Scanner de Documentos', text: 'Scanner de documentos (grátis, offline):', url }); }
      catch { /* cancelou */ }
    } else {
      try { await navigator.clipboard.writeText(url); aviso('Link copiado.'); }
      catch { aviso(url); }
    }
  });

  // botões principais
  $('#btn-camera').addEventListener('click', abrirCamera);
  $('#btn-importar').addEventListener('click', () => $('#input-arquivos').click());
  $('#input-arquivos').addEventListener('change', ev => {
    importarArquivos(ev.target.files);
    ev.target.value = '';
  });

  // câmera
  $('#btn-fechar-camera').addEventListener('click', () => { pararCamera(); irPara(App.paginas.length ? 'editor' : 'home'); });
  $('#btn-disparo').addEventListener('click', capturar);
  $('#btn-flash').addEventListener('click', alternarLanterna);
  $('#btn-auto-crop').addEventListener('click', () => recorteAutomatico(App.paginas));
  $('#btn-ver-paginas').addEventListener('click', () => irPara('editor'));

  // editor
  $('#btn-voltar-home').addEventListener('click', () => irPara('home'));
  $('#btn-mais').addEventListener('click', abrirCamera);
  $('#btn-limpar').addEventListener('click', limparTudo);
  $('#btn-gerar-pdf').addEventListener('click', gerarPDF);
  $('#btn-fotos').addEventListener('click', abrirFluxoFotos);

  // modal página
  $('#btn-pagina-fechar').addEventListener('click', fecharModalPagina);
  $('#modal-pagina').addEventListener('click', async ev => {
    const btn = ev.target.closest('.btn-acao');
    if (!btn) return;
    const id = App.paginaAtualModal;
    const p = acharPagina(id);
    const i = p ? App.paginas.indexOf(p) : -1;
    fecharModalPagina();
    if (!p) return;
    if (btn.dataset.a === 'girar') await acaoPagina(id, 'girar');
    else if (btn.dataset.a === 'recortar') await acaoPagina(id, 'recortar');
    else if (btn.dataset.a === 'auto') await acaoPagina(id, 'auto');
    else if (btn.dataset.a === 'imagem') await compartilharImagemDaPagina(p, i);
    else if (btn.dataset.a === 'excluir') await acaoPagina(id, 'excluir');
  });

  // modal fotos
  $('#btn-fotos-fechar').addEventListener('click', () => { $('#modal-fotos').hidden = true; });

  // modal recorte
  $('#btn-recorte-cancelar').addEventListener('click', () => { $('#modal-recorte').hidden = true; renderEditor(); });
  $('#btn-recorte-ok').addEventListener('click', confirmarRecorte);
  $('#btn-recorte-auto').addEventListener('click', async () => {
    const det = detectarBordas(Recorte.img);
    if (det) { definirCaixa(det); aviso('Bordas detectadas. Confira e toque em ✓.'); }
    else aviso('Não achei as bordas. Ajuste com o dedo.');
  });
  $('#btn-recorte-tudo').addEventListener('click', () => definirCaixa({ x: 0, y: 0, w: Recorte.img.width, h: Recorte.img.height }));
  ligarGestosRecorte();

  // status offline
  const st = $('#status-offline');
  const atualizar = () => {
    const on = navigator.onLine;
    st.innerHTML = on
      ? '📡 Conectado — <b>pronto para usar</b>. Instale na tela de início para abrir direto.'
      : '✈️ Sem internet — <b>o app continua funcionando</b> (offline).';
  };
  window.addEventListener('online', atualizar);
  window.addEventListener('offline', atualizar);
  atualizar();

  // mantém a câmera viva ao voltar para a aba
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pararCamera(); }
    else if ($('#tela-camera').classList.contains('ativa') && !App.stream) abrirCamera();
  });

  //atalho de diagnóstico
  $('#link-diagnostico').addEventListener('click', e => {
    e.preventDefault();
    aviso(navigator.canShare ? 'Suporte a compartilhamento de arquivos: OK' : 'Este navegador não compartilha arquivos.');
  });

  paginasCount();
  renderEditor();
  atualizarBotaoFiltro();
  registrarServiceWorker();

  // recupera o trabalho da sessão anterior (se houver)
  restaurarSessao();
}

/** Aplica as preferências salvas (qualidade, filtro, tamanho da página). */
function carregarPreferencias() {
  const c = CONFIG.ler();
  if (c.qualidade) App.qualidade = c.qualidade;
  if (c.filtro) App.filtro = c.filtro;
  if (c.modoPagina) App.modoPagina = c.modoPagina;

  const marcar = (seletor, attr, valor) => {
    const chip = $(`${seletor} .chip[data-${attr}="${valor}"]`);
    if (chip) {
      $$('.chip', $(seletor)).forEach(x => x.classList.remove('ativo'));
      chip.classList.add('ativo');
    }
  };
  marcar('#chips-qualidade', 'q', App.qualidade);
  marcar('#chips-filtro', 'f', App.filtro);
  marcar('#chips-pagina', 'p', App.modoPagina);
  $('#dica-qualidade').textContent = DICAS.qualidade[App.qualidade] || '';
  $('#dica-filtro').textContent = DICAS.filtro[App.filtro] || '';
}

/** Mostra o botão "aplicar ajuste a todas" só quando faz sentido. */
function atualizarBotaoFiltro() {
  const btn = $('#btn-aplicar-filtro');
  const precisa = App.paginas.some(p => p.filtro !== App.filtro);
  btn.hidden = !precisa;
  // o botão só aparece na tela inicial se houver páginas com ajuste diferente
  if (precisa && App.paginas.length) {
    btn.textContent = `Aplicar este ajuste às ${App.paginas.length} página(s)`;
  }
}

function registrarServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', iniciar);