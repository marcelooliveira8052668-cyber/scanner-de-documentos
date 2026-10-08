/* =========================================================
   app.js — Scanner de Documentos
   ========================================================= */
'use strict';

const App = {
  // "pastas" = documentos do usuário. Cada pasta tem suas próprias páginas.
  pastas: [],                  // [{ id, nome, criadaEm, paginas: [] }]
  pastaAtualId: null,
  paginas: [],                 // atalho: páginas da pasta aberta
  qualidade: 2400,
  filtro: 'auto',
  modoPagina: 'a4',
  stream: null,
  torch: false,
  paginaAtualModal: null
};

/* =========================================================
   Pastas (documentos)
   ========================================================= */
const novoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function pastaAtual() {
  return App.pastas.find(p => p.id === App.pastaAtualId) || null;
}

/** Guarda as páginas abertas dentro da pasta atual. */
function guardarNaPasta() {
  const p = pastaAtual();
  if (p) p.paginas = App.paginas;
}

function criarPasta(nome) {
  const pasta = {
    id: novoId('d'),
    nome: (nome || '').trim() || 'Documento sem nome',
    criadaEm: Date.now(),
    paginas: []
  };
  App.pastas.unshift(pasta);
  return pasta;
}

function abrirPasta(id) {
  guardarNaPasta();
  const pasta = App.pastas.find(p => p.id === id);
  if (!pasta) return;
  App.pastaAtualId = pasta.id;
  App.paginas = pasta.paginas || [];
  paginasCount();
  irPara('editor');
  renderEditor();
}

function excluirPasta(id) {
  const i = App.pastas.findIndex(p => p.id === id);
  if (i < 0) return;
  const pasta = App.pastas[i];
  if (!confirm(`Apagar a pasta "${pasta.nome}" e todas as folhas dela?`)) return;
  pasta.paginas.forEach(p => p.descartar());
  if (pasta.id === App.pastaAtualId) {
    App.pastaAtualId = null;
    App.paginas = [];
    paginasCount();
    if ($('#tela-editor').classList.contains('ativa')) irPara('home');
  }
  App.pastas.splice(i, 1);
  renderPastas();
  agendarSalvamento();
}

function renomearPasta(id, nome) {
  const pasta = App.pastas.find(p => p.id === id);
  if (!pasta) return;
  pasta.nome = (nome || '').trim() || pasta.nome;
  renderPastas();
  $('#editor-titulo').textContent = pasta.nome;
  $('#editor-sub').textContent = `${App.paginas.length} folha(s)`;
  agendarSalvamento();
}

function renderPastas() {
  const alvo = $('#lista-pastas');
  alvo.innerHTML = '';
  $('#pastas-vazio').hidden = App.pastas.length > 0;
  $('#btn-camera').hidden = false;

  for (const pasta of App.pastas) {
    const item = document.createElement('div');
    item.className = 'pasta-item';
    const folhas = (pasta.paginas || []).length;
    const quando = formatarData(pasta.criadaEm);
    item.innerHTML = `
      <button class="pasta-abrir" data-id="${pasta.id}">
        <span class="pasta-icone">📁</span>
        <span class="pasta-info">
          <b>${escaparHtml(pasta.nome)}</b>
          <small>${folhas} folha${folhas === 1 ? '' : 's'} · ${quando}</small>
        </span>
        <span class="pasta-seta">›</span>
      </button>
      <div class="pasta-acoes">
        <button class="mini-btn" data-id="${pasta.id}" data-p="renomear">✎</button>
        <button class="mini-btn" data-id="${pasta.id}" data-p="scan">📷</button>
        <button class="mini-btn perigo" data-id="${pasta.id}" data-p="excluir">🗑</button>
      </div>`;
    alvo.appendChild(item);
  }

  alvo.onclick = ev => {
    const acao = ev.target.closest('[data-p]');
    if (acao) {
      ev.stopPropagation();
      const id = acao.dataset.id;
      if (acao.dataset.p === 'renomear') pedirNome('Renomear pasta', App.pastas.find(p => p.id === id)?.nome || '', n => renomearPasta(id, n));
      else if (acao.dataset.p === 'excluir') excluirPasta(id);
      else if (acao.dataset.p === 'scan') { abrirPasta(id); abrirCamera(); }
      return;
    }
    const abrir = ev.target.closest('.pasta-abrir');
    if (abrir) abrirPasta(abrir.dataset.id);
  };
}

function formatarData(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const p = n => String(n).padStart(2, '0');
  return mesmoDia
    ? `hoje ${p(d.getHours())}h${p(d.getMinutes())}`
    : `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
  guardarNaPasta();
  const n = App.paginas.length;
  $('#contador').textContent = n + (n === 1 ? ' página' : ' páginas');
  const sub = $('#editor-sub');
  if (sub) sub.textContent = `${n} folha${n === 1 ? '' : 's'}`;

  // avisa quando o documento já é grande (mas nunca bloqueia)
  const aviso = $('#aviso-grande');
  if (n > 1 && aviso) {
    const peso = App.paginas.reduce((s, p) => s + p.largura * p.altura, 0);
    aviso.hidden = !(n >= 50 || peso > 260e6);
  } else if (aviso) {
    aviso.hidden = true;
  }
}

/* =========================================================
   Modelo de página
   ========================================================= */
function criarPagina(canvasOriginal, nome) {
  return {
    id: novoId('p'),
    nome: (nome || '').trim() || '',        // nome que o usuário deu à folha
    original: canvasOriginal,               // canvas sem filtro nem rotação
    filtro: App.filtro,
    rotacao: 0,
    url: null,                              // preenchido no render
    largura: canvasOriginal.width,
    altura: canvasOriginal.height,
    async canvasBase() {                    // original + filtro atual
      return aplicarFiltro(this.original, this.filtro);
    },
    async canvasFinal() {                   // + rotação
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
    // 0.94: qualidade alta — a mesma imagem serve a miniatura e o zoom
    // do modal; com pressão baixa o texto fica com "xuxa" ao ampliar.
    const blob = await canvasParaBlob(await pagina.canvasFinal(), 'image/jpeg', 0.94);
    pagina.url = URL.createObjectURL(blob);
  }
  return pagina.url;
}

function invalidarUrl(pagina) {
  if (pagina.url) { URL.revokeObjectURL(pagina.url); pagina.url = null; }
}

/**
 * Garante que existe uma pasta aberta (cria a primeira se não houver).
 * É por aqui que a pessoa sempre acaba: nunca fica "solto" sem pasta.
 */
function garantirPasta() {
  if (App.pastaAtualId && pastaAtual()) return pastaAtual();
  if (!App.pastas.length) criarPasta('Meu primeiro documento');
  const primeira = App.pastas[0];
  App.pastaAtualId = primeira.id;
  App.paginas = primeira.paginas || (primeira.paginas = []);
  return primeira;
}

/**
 * Adiciona uma folha a partir de um canvas já pronto.
 * Nenhum limite de quantidade: pode digitalizar 1 ou centenas de folhas.
 */
async function adicionarPagina(canvas, nome) {
  if (!garantirPasta()) return null;
  const pagina = criarPagina(canvas, nome);
  App.paginas.push(pagina);
  paginasCount();
  renderPastas();
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
  garantirPasta();
  await comCarregando(`Lendo ${arquivos.length} foto(s)…`, async () => {
    let i = 0;
    for (const arq of arquivos) {
      if (!arq.type.startsWith('image/')) continue;
      try {
        const img = await carregarImagem(arq);
        // já dá um nome a cada folha: o número do arquivo
        let folha = canvasLimitado(img, App.qualidade);
        folha = realcarNitidez(folha);   // mesmo realce da câmera: texto sapecado
        await adicionarPagina(folha, `Folha ${++i}`);
      } catch (e) {
        aviso('Não consegui ler uma das fotos.');
      }
    }
  });
  renderPastas();
  irPara('editor');
  renderEditor();
}

/* =========================================================
   Enquadramento automático ao vivo
   ------------------------------------------------------------
   A câmera procura a folha a cada instante, desenha um guia
   que se ajusta no papel e já entrega a foto recortada.
   ========================================================= */
const Quadro = {
  ativo: true,          // ligado/desligado pelo botão do topo
  ret: null,            // { x, y, w, h } em pixels da imagem "canônica"
  anterior: null,       // detecção anterior (para medir estabilidade)
  estavel: 0,           // quantas detecções seguidos ficaram parecidos
  animando: false,
  ultimaTentativa: 0,
  ultimoAcerto: 0,      // quando a folha foi detectada da última vez (ms)
  provisorio: false     // true = guia é só um chute (tracejado amarelo), ainda não achou o papel
};

const INTERVALO_DETECCAO = 130;   // ms entre leituras (não pesa no iPhone)
const LARGURA_DETECCAO = 170;    // largura da miniatura analisada

/** Mede o vídeo e diz se o quadro vem "deitado" (acontece no iPhone). */
function geometriaVideo(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const r = video.getBoundingClientRect();
  const emPe = r.height > r.width;
  const deitado = vw > vh;
  const girar = deitado && emPe;
  return {
    vw, vh,
    largura: girar ? vh : vw,     // tamanho da imagem como o app guarda
    altura: girar ? vw : vh,
    girar
  };
}

/** Converte um ponto do quadro do vídeo para a imagem canônica (giro aplicado). */
function pontoParaCanonico(px, py, geo) {
  return geo.girar ? { x: geo.vh - py, y: px } : { x: px, y: py };
}

/** Converte um ponto canônico de volta para o quadro do vídeo. */
function pontoParaVideo(cx, cy, geo) {
  return geo.girar ? { x: cy, y: geo.vh - cx } : { x: cx, y: cy };
}

/** Mapeia do quadro do vídeo para a tela, respeitando object-fit: cover. */
function montarMapeamentoTela(video, geo) {
  const r = video.getBoundingClientRect();
  if (!r.width || !r.height || !geo.vw) return null;
  const escala = Math.max(r.width / geo.vw, r.height / geo.vh);
  return {
    escala,
    dx: (r.width - geo.vw * escala) / 2,
    dy: (r.height - geo.vh * escala) / 2,
    larguraTela: r.width,
    alturaTela: r.height
  };
}

/** Liga a leitura contínua da câmera. */
function ligarDeteccao() {
  Quadro.ret = null;
  Quadro.anterior = null;
  Quadro.estavel = 0;
  Quadro.provisorio = false;
  Quadro.ultimoAcerto = 0;
  Quadro.animando = true;
  if (Quadro.raf) cancelAnimationFrame(Quadro.raf);
  quadroLaco();
}

function desligarDeteccao() {
  Quadro.animando = false;
  if (Quadro.raf) cancelAnimationFrame(Quadro.raf);
  Quadro.raf = null;
  Quadro.ret = null;
  Quadro.provisorio = false;
  Quadro.estavel = 0;
  const el = $('#estado-quadro');
  if (el) el.hidden = true;
}

function quadroLaco() {
  Quadro.raf = requestAnimationFrame(quadroLaco);
  const video = $('#video');
  if (!video || !video.videoWidth) return;
  const agora = performance.now();
  if (agora - Quadro.ultimaTentativa < INTERVALO_DETECCAO) return;
  Quadro.ultimaTentativa = agora;

  if (!Quadro.ativo || document.hidden) { limparGuia(); return; }

  const geo = geometriaVideo(video);
  const tela = montarMapeamentoTela(video, geo);
  if (!tela) return;

  // analyze uma miniatura: rápido e leve
  const escala = LARGURA_DETECCAO / geo.vw;
  const mini = Quadro.mini || (Quadro.mini = novoCanvas(1, 1));
  mini.width = LARGURA_DETECCAO;
  mini.height = Math.max(1, Math.round(geo.vh * escala));
  const ctx = mini.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(video, 0, 0, mini.width, mini.height);
  } catch { return; }

  const det = detectarBordas(mini);
  if (!det) {
    // Perdeu a folha por um instante (movimento da mão, sombra…):
    // segura o último guia por 1,2s para a tela não piscar, e depois
    // mostra o retângulo provisório (tracejado amarelo) orientando o usuário.
    const segurando = Quadro.ret && (agora - Quadro.ultimoAcerto) < 1200;
    if (!segurando) {
      Quadro.ret = retanguloPadrao(geo);
      Quadro.provisorio = true;
      Quadro.anterior = null;
      Quadro.estavel = 0;
      marcarEstado('Aproxime a folha até o guia ficar verde', false);
      desenharGuia(video, geo, tela, Quadro.ret);
      return;
    }
    Quadro.provisorio = true;
    marcarEstado('Aproxime a folha até o guia ficar verde', false);
    return;
  }

  // a miniatura tem o tamanho do QUADRO do vídeo: a escala usa vw/vh,
  // e só depois o ponto é levar para a imagem canônica (já girada)
  const fx = geo.vw / mini.width;
  const fy = geo.vh / mini.height;
  const canto = pontoParaCanonico(det.x * fx, det.y * fy, geo);
  const canto2 = pontoParaCanonico((det.x + det.w) * fx, (det.y + det.h) * fy, geo);
  const rect = {
    x: Math.min(canto.x, canto2.x),
    y: Math.min(canto.y, canto2.y),
    w: Math.abs(canto2.x - canto.x),
    h: Math.abs(canto2.y - canto.y)
  };

  // trava o retângulo na imagem canônica (nunca fora dela)
  rect.x = clamp(rect.x, 0, geo.largura);
  rect.y = clamp(rect.y, 0, geo.altura);
  rect.w = clamp(rect.w, 10, geo.largura - rect.x);
  rect.h = clamp(rect.h, 10, geo.altura - rect.y);

  // quanto tempo a folha está parada na mesma posição
  const ant = Quadro.anterior;
  if (ant && Math.abs(ant.x - rect.x) < geo.largura * 0.02 &&
      Math.abs(ant.y - rect.y) < geo.altura * 0.02 &&
      Math.abs(ant.w - rect.w) < geo.largura * 0.02 &&
      Math.abs(ant.h - rect.h) < geo.altura * 0.02) {
    Quadro.estavel = Math.min(Quadro.estavel + 1, 4);
  } else {
    Quadro.estavel = 0;
  }
  Quadro.anterior = rect;
  Quadro.ret = rect;
  Quadro.ultimoAcerto = agora;
  Quadro.provisorio = false;

  // Verde só quando a folha parou de mexer entre leituras (estável).
  marcarEstado(Quadro.estavel >= 2 ? 'Folha enquadrada ✓' : 'Ajustando…', Quadro.estavel >= 2);
  desenharGuia(video, geo, tela, rect);
}

/** Retângulo "chute" usado quando a folha ainda não foi encontrada:
 *  ocupa o centro da tela e serve de referência para o usuário posicionar o papel. */
function retanguloPadrao(geo) {
  const mx = geo.largura * 0.10, my = geo.altura * 0.12;
  return { x: mx, y: my, w: geo.largura - mx * 2, h: geo.altura - my * 2 };
}

function limparGuia() {
  const c = $('#guia-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
}

function marcarEstado(texto, pronto) {
  const el = $('#estado-quadro');
  el.hidden = false;
  el.classList.toggle('pronto', !!pronto);
  $('#estado-quadro-txt').textContent = texto;
}

/** Desenha o guia: escurece fora da folha e marca as bordas. */
function desenharGuia(video, geo, tela, rect) {
  const c = $('#guia-canvas');
  const larguraTela = Math.round(tela.larguraTela);
  const alturaTela = Math.round(tela.alturaTela);
  if (c.width !== larguraTela || c.height !== alturaTela) {
    c.width = larguraTela;
    c.height = alturaTela;
  }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  // 1) escurecer tudo que está fora do papel
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, .45)';
  ctx.beginPath();
  ctx.rect(0, 0, c.width, c.height);

  // o retângulo do papel, em coordenadas da tela
  const cantos = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h]
  ].map(([cx, cy]) => {
    const p = pontoParaVideo(cx, cy, geo);
    return [p.x * tela.escala + tela.dx, p.y * tela.escala + tela.dy];
  });

  ctx.moveTo(cantos[0][0], cantos[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(cantos[i][0], cantos[i][1]);
  ctx.closePath();
  ctx.fill('evenodd');
  ctx.restore();

  // 2) borda destacada:
  //    - VERDE com brilho quando a folha está parada e enquadrada (pode fotografar);
  //    - AMARELA TRACEJADA enquanto é só um chute (provisório, folha não encontrada);
  //    - branca enquanto a folha ainda está sendo ajustada.
  const pronto = Quadro.estavel >= 2 && !Quadro.provisorio;
  ctx.save();
  ctx.lineWidth = 3;
  if (Quadro.provisorio) ctx.setLineDash([12, 9]);
  ctx.strokeStyle = pronto ? '#22c07a'
    : (Quadro.provisorio ? 'rgba(255,209,102,.95)' : 'rgba(255,255,255,.92)');
  ctx.shadowColor = pronto ? 'rgba(34,192,122,.8)' : 'rgba(0,0,0,.5)';
  ctx.shadowBlur = pronto ? 14 : 6;
  ctx.beginPath();
  ctx.moveTo(cantos[0][0], cantos[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(cantos[i][0], cantos[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Liga/desliga o enquadramento automático. */
function alternarQuadro() {
  Quadro.ativo = !Quadro.ativo;
  $('#btn-auto-quadro').classList.toggle('ativo', Quadro.ativo);
  if (!Quadro.ativo) {
    Quadro.ret = null;
    Quadro.estavel = 0;
    Quadro.provisorio = false;
    limparGuia();
    $('#estado-quadro').hidden = true;
    aviso('Enquadramento automático desligado.');
  } else {
    aviso('Enquadramento automático ligado.');
  }
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
        // Resolução máxima do iPhone (12 MP): quanto mais pixels a câmera
        // entregar, mais nítida sai a folha depois de recortada.
        width: { ideal: 4032 },
        height: { ideal: 3024 },
        // Evita o modo "economia de dados" que entrega quadro borrado
        frameRate: { ideal: 30, min: 15 }
      },
      audio: false
    });
    const video = $('#video');
    video.srcObject = App.stream;
    await video.play();
    await video.play().catch(() => {});
    verificarLanterna();
    conferirResolucaoCamera();
    ligarDeteccao();
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

/**
 * Confere quantos pixels a câmera realmente entregou.
 * Se vier apertado, tenta aumentar; se não der, avisa para aproximar a folha —
 * poucos pixels na origem = texto ilegível quando a pessoa amplia a foto.
 */
function conferirResolucaoCamera() {
  const track = App.stream && App.stream.getVideoTracks()[0];
  if (!track || !track.getSettings) return;
  const s = track.getSettings();
  if (!s.width || s.width >= 2000) return;
  track.applyConstraints({ width: { ideal: 4032 }, height: { ideal: 3024 } })
    .then(() => {
      const s2 = track.getSettings();
      if (s2.width && s2.width < 1600) {
        aviso(`Câmera entregou só ${s2.width} px. Aproxime a folha para o texto sair nítido.`, 5200);
      }
    })
    .catch(() => {
      aviso(`Câmera limitada a ${s.width} px. Aproxime a folha para o texto sair nítido.`, 5200);
    });
}

function pararCamera() {
  desligarDeteccao();
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

/** Fotografa a folha — já sai recortada no que a câmera encontrou. */
async function capturar() {
  const video = $('#video');
  if (!video.videoWidth) { aviso('Aguarde a câmera abrir.'); return; }

  const flash = $('#flash');
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 130);

  // Só corta no retângulo se a folha foi realmente detectada
  // (Quadro.provisorio = o guia era só um chute, não a folha em si).
  const enquadrado = !!(Quadro.ativo && Quadro.ret && !Quadro.provisorio);
  const geo = geometriaVideo(video);
  let dimSalva = '';

  await comCarregando('Processando folha…', async () => {
    const bruto = novoCanvas(geo.vw, geo.vh);
    bruto.getContext('2d').drawImage(video, 0, 0, geo.vw, geo.vh);

    // o iPhone às vezes entrega o quadro deitado: gira para ficar em pé
    let base = geo.girar ? rotacionarCanvas(bruto, 90) : bruto;

    // corta o que está fora da folha (o que a câmera desenhou no guia)
    if (enquadrado) {
      base = recortarCanvas(base, Quadro.ret);
    }

    let folha = canvasLimitado(base, App.qualidade);
    // afina o texto: tira o borrão leve que a câmera deixa
    folha = realcarNitidez(folha);
    dimSalva = `${folha.width}×${folha.height}`;
    await adicionarPagina(folha, `Folha ${App.paginas.length + 1}`);
  });

  paginasCount();
  aviso(`${enquadrado ? 'Folha enquadrada e salva ✓' : 'Folha salva ✓ (sem enquadrar: use ✂ para cortar)'} — ${dimSalva} px`, 4200);

  // já começa a procurar a próxima folha
  Quadro.anterior = null;
  Quadro.estavel = 0;
}

/* =========================================================
   Editor: lista de páginas
   ========================================================= */
/** Desenha o cartão de uma folha na lista. */
function cartaoPagina(p, i, total) {
  const nome = p.nome || `Folha ${i + 1}`;
  const card = document.createElement('div');
  card.className = 'pagina';
  card.innerHTML = `
    <div class="mini"><img alt="${escaparHtml(nome)}"></div>
    <div class="info">
      <div class="num">
        <button class="nome-folha" data-a="renomear">✎ ${escaparHtml(nome)}</button>
        <small>${i + 1}/${total}</small>
      </div>
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
    const btn = ev.target.closest('[data-a]');
    if (!btn || btn.disabled) return;
    acaoPagina(p.id, btn.dataset.a);
  });
  return card;
}

/**
 * Lista as folhas mostrando no máximo 60 por vez (miniaturas em memória são caras).
 * Documentos grandes continuam inteiros: a lista só deixa de mostrar até você pedir mais.
 */
const PAGINAS_POR_VEZ = 60;
let quantasMostradas = PAGINAS_POR_VEZ;

async function renderEditor() {
  const lista = $('#lista-paginas');
  lista.innerHTML = '';
  guardarNaPasta();

  const pasta = pastaAtual();
  const total = App.paginas.length;
  $('#editor-vazio').hidden = total > 0;
  $('#editor-titulo').textContent = pasta ? pasta.nome : 'Minhas páginas';
  $('#editor-sub').textContent = `${total} folha${total === 1 ? '' : 's'}`;
  atualizarBotaoFiltro();

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
    mais.textContent = `Mostrar mais ${Math.min(PAGINAS_POR_VEZ, total - limite)} folhas (de ${total})`;
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

    case 'renomear':
      renomearFolha(id, i);
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
  guardarNaPasta();
  const temFolhas = App.pastas.some(p => (p.paginas || []).length);
  if (!temFolhas) {
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
    guardarNaPasta();
    const pastas = [];
    for (const pasta of App.pastas) {
      const itens = [];
      for (const p of (pasta.paginas || [])) {
        // 0.94: guarda quase sem perda — se guardar com pressão,
        // o PDF gerado depois de reabrir o app sai borrado.
        const blob = await canvasParaBlob(p.original, 'image/jpeg', 0.94);
        itens.push({
          blob, largura: p.largura, altura: p.altura,
          rotacao: p.rotacao, filtro: p.filtro, nome: p.nome || ''
        });
      }
      pastas.push({ id: pasta.id, nome: pasta.nome, criadaEm: pasta.criadaEm, paginas: itens });
    }
    await DB.salvarSessao({
      versao: 2,
      quando: Date.now(),
      qualidade: App.qualidade,
      filtro: App.filtro,
      modoPagina: App.modoPagina,
      pastaAtualId: App.pastaAtualId,
      pastas
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
  if (!dados) return false;

  // formato antigo (v1): uma pasta só
  if (!Array.isArray(dados.pastas)) {
    if (!Array.isArray(dados.paginas) || !dados.paginas.length) return false;
    dados = { versao: 2, pastaAtualId: null, pastas: [{ id: novoId('d'), nome: 'Meu documento', criadaEm: Date.now(), paginas: dados.paginas }] };
  }
  if (!dados.pastas.length) return false;

  let total = 0;
  await comCarregando('Recuperando seu trabalho…', async () => {
    for (const info of dados.pastas) {
      const pasta = { id: info.id || novoId('d'), nome: info.nome || 'Documento', criadaEm: info.criadaEm || Date.now(), paginas: [] };
      for (const it of (info.paginas || [])) {
        if (!it.blob) continue;
        try {
          const img = await carregarImagem(it.blob);
          const c = novoCanvas(it.largura || img.naturalWidth, it.altura || img.naturalHeight);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const p = criarPagina(c, it.nome || '');
          p.rotacao = it.rotacao || 0;
          p.filtro = it.filtro || App.filtro;
          pasta.paginas.push(p);
          total++;
        } catch { /* pula folha corrompida */ }
      }
      App.pastas.push(pasta);
    }
  });

  if (!total) { App.pastas = []; return false; }

  // abre a pasta que estava sendo usada
  const alvo = App.pastas.find(p => p.id === dados.pastaAtualId) || App.pastas.find(p => p.paginas.length) || App.pastas[0];
  abrirPasta(alvo.id);
  renderPastas();
  aviso(`Recuperei ${total} folha(s) em ${App.pastas.length} pasta(s).`, 3800);
  return true;
}

function limparTudo() {
  if (!App.paginas.length) return;
  const pasta = pastaAtual();
  if (!confirm(`Apagar as ${App.paginas.length} folha(s) da pasta "${pasta ? pasta.nome : ''}"?`)) return;
  App.paginas.forEach(p => p.descartar());
  App.paginas = [];
  guardarNaPasta();
  paginasCount();
  clearTimeout(timerSalvar);
  if (App.pastas.some(p => (p.paginas || []).length)) agendarSalvamento();
  else { DB.limparSessao(); mostrarStatus('', false); }
  renderEditor();
  renderPastas();
}

/* =========================================================
   Dar nome (pasta ou folha)
   ========================================================= */
let destinoNome = null;   // função chamada com o valor digitado

function pedirNome(titulo, valorInicial, aoSalvar, sugestoes = [], dica = '') {
  destinoNome = aoSalvar;
  $('#nome-titulo').textContent = titulo;
  $('#nome-dica').textContent = dica;
  const campo = $('#campo-nome');
  campo.value = valorInicial || '';

  const alvo = $('#sugestoes-nome');
  alvo.innerHTML = '';
  for (const s of sugestoes) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => { campo.value = s; campo.focus(); });
    alvo.appendChild(chip);
  }
  alvo.hidden = !sugestoes.length;

  $('#modal-nome').hidden = false;
  setTimeout(() => campo.focus(), 60);
}

function confirmarNome() {
  const valor = $('#campo-nome').value.trim();
  $('#modal-nome').hidden = true;
  const aplicar = destinoNome;
  destinoNome = null;
  if (aplicar) aplicar(valor);
}

function renomearFolha(id, indice) {
  const p = acharPagina(id);
  if (!p) return;
  const pasta = pastaAtual();
  const sugere = [];
  if (pasta && pasta.nome) sugere.push(pasta.nome);
  sugere.push(`Folha ${indice + 1}`);
  pedirNome(
    `Nome da folha ${indice + 1}`,
    p.nome || `Folha ${indice + 1}`,
    valor => {
      p.nome = valor || `Folha ${indice + 1}`;
      guardarNaPasta();
      renderEditor();
      agendarSalvamento();
    },
    sugere,
    'O nome fica salvo com a folha. Exemplos: Capa, Assinatura, Anexo 2.'
  );
}

/** Renomeia todas em sequência: "Recibo" vira Recibo 1, Recibo 2, … */
function renomearTodas() {
  const pasta = pastaAtual();
  const base = (pasta && pasta.nome) || 'Folha';
  pedirNome(
    'Nome em sequência',
    base,
    valor => {
      const limpo = (valor || 'Folha').trim() || 'Folha';
      App.paginas.forEach((p, i) => { p.nome = `${limpo} ${i + 1}`; });
      guardarNaPasta();
      renderEditor();
      agendarSalvamento();
      aviso(`Folhas renomeadas: ${limpo} 1, ${limpo} 2…`);
    },
    [pasta ? pasta.nome : 'Folha', 'Capa', 'Folha'],
    'Todas as folhas recebem esse nome com numeração automática.'
  );
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
  // a resolução fica à vista: ajuda a entender se a foto saiu apertada
  $('#pagina-titulo').textContent = `Página ${i + 1} · ${p.largura}×${p.altura} px`;
  const img = $('#img-pagina-modal');
  // garante a versão em alta qualidade (gera o blob se ainda não existir)
  img.src = '';
  urlDaPagina(p).then(url => {
    if (App.paginaAtualModal === id) img.src = url;
  });
  ZoomPreview.resetar();
  $('#modal-pagina').hidden = false;
  // enquanto a pessoa nunca tiver ampliado, ensina o gesto
  if (!ZoomPreview.jaAmpliou) {
    aviso('Amplie com a pinça de 2 dedos, toque duplo, ou use o botão ＋', 5200);
  }
}

function fecharModalPagina() {
  $('#modal-pagina').hidden = true;
  App.paginaAtualModal = null;
  ZoomPreview.resetar();
}

/* =========================================================
   Zoom por gesto na prévia da página
   ------------------------------------------------------------
   O zoom do navegador re-amostra a imagem (fica borrada).
   Aqui a pinça muda a LARGURA do <img>: o navegador renderiza
   de novo direto do arquivo original — o texto fica nítido.
   ========================================================= */
const ZoomPreview = {
  escala: 1,
  x: 0,
  y: 0,
  baseW: 0,          // largura renderizada em escala 1
  baseEscala: 1,
  distBase: 0,
  gestBase: 1,       // escala no início do gesto nativo do iPhone
  gestoes: false,    // true = o iPhone cuida da pinça (gesture*)
  xBase: 0,
  yBase: 0,
  x0: 0,
  y0: 0,
  arrastando: false,
  // já ampliou alguma vez? (para mostrar a dica só enquanto não souber)
  jaAmpliou: (() => { try { return localStorage.getItem('zoomJaUsou') === '1'; } catch (_) { return false; } })(),

  resetar() {
    const img = $('#img-pagina-modal');
    this.escala = 1; this.x = 0; this.y = 0;
    this.baseW = 0; this.arrastando = false; this.distBase = 0;
    if (img) {
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.transform = '';
    }
    const ind = $('#zoom-escala');
    if (ind) ind.textContent = '1×';
  }
};

function ligarZoomPreview() {
  const alvo = $('#modal-pagina .preview-pagina');
  const img = $('#img-pagina-modal');
  if (!alvo || !img) return;
  // evita escutar os gestos duas vezes se chamarem a função de novo
  if (alvo.dataset.zoomLigado) return;
  alvo.dataset.zoomLigado = '1';
  const z = ZoomPreview;

  /* No iPhone a pinça NÃO vem como touchstart/touchmove: o Safari entrega
     gesturestart/gesturechange e, se ninguém chamar preventDefault(), ele
     amplia a PÁGINA inteira (a foto não muda). Por isso o caminho abaixo. */
  z.gestoes = 'ongesturestart' in window;

  const indicar = () => {
    const el = $('#zoom-escala');
    if (el) el.textContent = z.escala <= 1.02 ? '1×' : (Math.round(z.escala * 10) / 10) + '×';
  };

  const aplicar = () => {
    if (z.escala <= 1.02) {
      img.style.width = ''; img.style.height = '';
      img.style.maxWidth = ''; img.style.maxHeight = '';
      img.style.transform = '';
      z.escala = 1; z.x = 0; z.y = 0; z.baseW = 0;
      indicar();
      return;
    }
    if (!z.baseW) z.baseW = img.offsetWidth;
    // muda a LARGURA (não transform: scale) => o navegador re-renderiza
    // direto do arquivo original, sem re-amostrar: o texto fica nítido
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = (z.baseW * z.escala) + 'px';
    img.style.height = 'auto';
    img.style.transform = `translate(${Math.round(z.x)}px, ${Math.round(z.y)}px)`;
    indicar();
    if (z.escala > 1.2 && !z.jaAmpliou) {
      z.jaAmpliou = true;
      try { localStorage.setItem('zoomJaUsou', '1'); } catch (_) {}
    }
  };

  const limitar = () => {
    z.escala = clamp(z.escala, 1, 6);
    if (z.escala <= 1.02) { z.x = 0; z.y = 0; return; }
    if (!z.baseW) z.baseW = img.offsetWidth;
    const w = z.baseW * z.escala;
    const maxX = Math.max(0, (w - alvo.clientWidth) / 2 + 10);
    z.x = clamp(z.x, -maxX, maxX);
    const h = img.naturalWidth ? (img.naturalHeight / img.naturalWidth) * w : w;
    const maxY = Math.max(0, (h - alvo.clientHeight) / 2 + 10);
    z.y = clamp(z.y, -maxY, maxY);
  };

  const nosControles = ev => !!(ev.target && ev.target.closest && ev.target.closest('.zoom-controles'));

  /* ---------------- botões + / − / 1× ---------------- */
  const btn = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', e => { e.stopPropagation(); fn(); });
  };
  btn('#zoom-mais', () => { z.escala = clamp(z.escala * 1.7, 1, 6); limitar(); aplicar(); });
  btn('#zoom-menos', () => { z.escala = clamp(z.escala / 1.7, 1, 6); limitar(); aplicar(); });
  btn('#zoom-escala', () => { z.escala = 1; z.x = 0; z.y = 0; aplicar(); });

  /* ---------------- iPhone: gesto nativo da pinça ---------------- */
  // registrados sempre: em navegadores que não emitem, são ociosos
  alvo.addEventListener('gesturestart', ev => {
    if (nosControles(ev)) return;
    ev.preventDefault();                      // segura o zoom da página
    z.gestBase = z.escala;
    z.distBase = 0;                           // deixa o caminho de touch quieto
    z.arrastando = false;
  }, { passive: false });
  alvo.addEventListener('gesturechange', ev => {
    if (nosControles(ev)) return;
    ev.preventDefault();
    z.escala = z.gestBase * (ev.scale || 1);
    limitar(); aplicar();
  }, { passive: false });
  alvo.addEventListener('gestureend', ev => {
    if (ev.cancelable) ev.preventDefault();
    z.distBase = 0;
  }, { passive: false });

  /* ---------------- Android / computador: pinça pelo toque ---------------- */
  const pontos = ev => Array.from(ev.touches).map(t => ({ x: t.clientX, y: t.clientY }));
  const distancia = a => Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y);

  alvo.addEventListener('touchstart', ev => {
    if (nosControles(ev)) return;
    if (ev.touches.length === 2) {
      if (z.gestoes) return;                    // no iPhone quem cuida é o gesture*
      z.distBase = distancia(pontos(ev)) || 1;
      z.baseEscala = z.escala;
      z.xBase = z.x; z.yBase = z.y;
      z.arrastando = false;
    } else if (ev.touches.length === 1 && z.escala > 1) {
      z.arrastando = true;                      // arrasta a foto ampliada
      z.xBase = z.x; z.yBase = z.y;
      z.x0 = ev.touches[0].clientX; z.y0 = ev.touches[0].clientY;
    }
  }, { passive: true });

  alvo.addEventListener('touchmove', ev => {
    if (nosControles(ev)) return;
    if (!z.gestoes && ev.touches.length === 2 && z.distBase > 0) {
      z.escala = z.baseEscala * (distancia(pontos(ev)) / z.distBase);
      limitar(); aplicar();
      if (ev.cancelable) ev.preventDefault();
    } else if (z.arrastando && ev.touches.length === 1) {
      z.x = z.xBase + (ev.touches[0].clientX - z.x0);
      z.y = z.yBase + (ev.touches[0].clientY - z.y0);
      limitar(); aplicar();
      if (ev.cancelable) ev.preventDefault();
    }
  }, { passive: false });

  // toque duplo detectado à mão (o dblclick nem sempre dispara no iOS)
  let ultimoToque = 0;
  const fim = ev => {
    if (nosControles(ev)) return;
    if (ev.touches.length < 2) z.distBase = 0;
    if (ev.touches.length === 0) {
      z.arrastando = false;
      const agora = Date.now();
      if (agora - ultimoToque < 320 && !z.moveu) {
        if (z.escala > 1) { z.escala = 1; z.x = 0; z.y = 0; }
        else { z.escala = 2.5; z.x = 0; z.y = 0; }
        aplicar();
        ultimoToque = 0;
      } else {
        ultimoToque = agora;
      }
      z.moveu = false;
    }
  };
  alvo.addEventListener('touchend', fim);
  alvo.addEventListener('touchcancel', fim);

  // marca se houve arrasto/pinça para não confundir com toque duplo
  alvo.addEventListener('touchmove', ev => { if (!nosControles(ev)) z.moveu = true; }, { passive: true });

  // computador: zoom com a roda (Ctrl + roda)
  alvo.addEventListener('wheel', ev => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    z.escala = clamp(z.escala * (ev.deltaY < 0 ? 1.15 : 0.87), 1, 6);
    limitar(); aplicar();
  }, { passive: false });
}

/* =========================================================
   Compartilhar uma página como imagem (iCloud Fotos)
   ========================================================= */
async function compartilharImagemDaPagina(pagina, indice) {
  await comCarregando('Preparando a imagem…', async () => {
    // 0.97: quase sem perda — o WhatsApp recomprime por cima, então quanto
    // menos defeito chegar nessa etapa, mais legível fica o texto lá na frente
    const blob = await canvasParaBlob(await pagina.canvasFinal(), 'image/jpeg', 0.97);
    const nome = nomeDeArquivo(pagina.nome || `Folha ${indice + 1}`, 'jpg');
    await compartilharArquivo(blob, nome, pagina.nome || `Folha ${indice + 1}`);
  });
  if (ehApple()) aviso('No menu de compartilhamento escolha “Salvar Imagem” para ir ao iCloud Fotos.', 4200);
}

function abrirFluxoFotos() {
  const alvo = $('#passos-fotos');
  alvo.innerHTML = '';
  App.paginas.forEach((p, i) => {
    const rotulo = p.nome || `Folha ${i + 1}`;
    urlDaPagina(p).then(url => {
      const div = document.createElement('div');
      div.className = 'passo';
      div.innerHTML = `
        <img src="${url}" alt="${escaparHtml(rotulo)}">
        <div class="n"><b>${escaparHtml(rotulo)}</b><small>Toque em enviar e depois em “Salvar Imagem”.</small></div>
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
   Enviar
   ------------------------------------------------------------
   Foto por foto o WhatsApp fica poluído. A ideia é mandar
   sempre UM arquivo: 1 PDF por pasta, ou tudo junto num .zip —
   que chega na outra pessoa como uma pastinha de documentos.
   ========================================================= */

/** Gera o PDF de uma lista de folhas. */
async function pdfDasPaginas(lista, titulo) {
  const itens = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    const canvas = await p.canvasBase();
    // 0.95: JPEG quase sem perda — texto pequeno continua legível no PDF
    const jpeg = await canvasParaBlob(canvas, 'image/jpeg', 0.95);
    itens.push({
      bytes: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
      rotation: p.rotacao
    });
    if (i % 15 === 14) await new Promise(r => setTimeout(r));   // respira o iPhone
  }
  return montarPDF(itens, { modo: App.modoPagina, titulo: titulo || 'Documento digitalizado' });
}

/** Nome de arquivo seguro, feito a partir do nome da pasta. */
function nomeDeArquivo(base, extensao) {
  const limpo = String(base || 'Documento').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'Documento';
  return `${limpo}.${extensao}`;
}

/** Envia a pasta aberta como um PDF (um arquivo só). */
async function enviarPasta() {
  if (!App.paginas.length) { aviso('Esta pasta ainda não tem folhas.'); return; }
  const pasta = pastaAtual();
  const nomeBase = pasta ? pasta.nome : 'Documento';
  const total = App.paginas.length;

  const blob = await comCarregando(`Gerando o PDF de ${total} folha(s)…`, async () =>
    pdfDasPaginas(App.paginas, nomeBase));

  await compartilharArquivo(blob, nomeDeArquivo(nomeBase, 'pdf'), nomeBase);
  const mb = (blob.size / 1048576).toFixed(1);
  aviso(
    `PDF "${nomeBase}.pdf" (${mb} MB) pronto. ` +
    (ehApple() ? 'No menu do iPhone, "Armazenar em Arquivos" guarda no iCloud.' : ''),
    4600
  );
}

/**
 * Envia TUDO de uma vez: um PDF por pasta, dentro de um .zip.
 * A pessoa recebe um arquivo só e, ao abrir, vê uma pasta por documento.
 */
async function enviarTudo() {
  guardarNaPasta();
  const comFolhas = App.pastas.filter(p => (p.paginas || []).length);
  if (!comFolhas.length) { aviso('Não há folhas digitalizadas ainda.'); return; }
  const totalFolhas = comFolhas.reduce((s, p) => s + p.paginas.length, 0);

  const blob = await comCarregando(`Preparando ${comFolhas.length} documento(s)…`, async () => {
    const arquivos = [];
    for (const pasta of comFolhas) {
      $('#carregando-txt').textContent = `Gerando o PDF de "${pasta.nome}"…`;
      const pdf = await pdfDasPaginas(pasta.paginas, pasta.nome);
      arquivos.push({
        nome: nomeDeArquivo(pasta.nome, 'pdf'),
        pasta: pasta.nome,                       // vira subpasta dentro do zip
        bytes: new Uint8Array(await pdf.arrayBuffer())
      });
      await new Promise(r => setTimeout(r));
    }
    $('#carregando-txt').textContent = 'Montando a pastinha (.zip)…';
    return criarZip(arquivos);
  });

  const nomeZip = nomeComData('Documentos', 'zip');
  await compartilharArquivo(blob, nomeZip, 'Meus documentos digitalizados');

  const mb = (blob.size / 1048576).toFixed(1);
  aviso(
    `Pastinha com ${comFolhas.length} documento(s) e ${totalFolhas} folha(s), ${mb} MB. ` +
    (ehApple() ? 'A pessoa abre e vê uma pasta por documento.' : 'A pessoa só precisa descompactar.'),
    5200
  );
}

/**
 * Envia os PDFs de todas as pastas como vários arquivos na mesma mensagem.
 * No WhatsApp isso chega como um envio único com N documentos: a pessoa toca
 * e abre, sem precisar descompactar nada.
 */
async function enviarSeparado() {
  guardarNaPasta();
  const comFolhas = App.pastas.filter(p => (p.paginas || []).length);
  if (!comFolhas.length) { aviso('Não há folhas digitalizadas ainda.'); return; }

  const arquivos = await comCarregando(`Gerando ${comFolhas.length} PDF(s)…`, async () => {
    const lista = [];
    for (const pasta of comFolhas) {
      $('#carregando-txt').textContent = `Gerando o PDF de "${pasta.nome}"…`;
      const pdf = await pdfDasPaginas(pasta.paginas, pasta.nome);
      lista.push(new File([pdf], nomeDeArquivo(pasta.nome, 'pdf'), { type: 'application/pdf' }));
      await new Promise(r => setTimeout(r));
    }
    return lista;
  });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: arquivos })) {
    try {
      await navigator.share({ files: arquivos, title: 'Meus documentos' });
      aviso(`${arquivos.length} documento(s) enviados de uma vez.`, 4000);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // a pessoa cancelou
    }
  }

  // aparelho sem suporte a vários arquivos: cai para o .zip, que também é fácil
  const zip = await comCarregando('Montando a pastinha (.zip)…', async () => {
    const itens = [];
    for (const arq of arquivos) {
      itens.push({
        nome: arq.name,
        pasta: arq.name.replace(/\.pdf$/i, ''),
        bytes: new Uint8Array(await arq.arrayBuffer())
      });
    }
    return criarZip(itens);
  });
  await compartilharArquivo(zip, nomeComData('Documentos', 'zip'), 'Meus documentos');
  aviso('Este aparelho não envia vários arquivos juntos: mandei uma pastinha .zip.', 4200);
}

async function gerarPDF() {
  await enviarPasta();
}

/* =========================================================
   Cor do aplicativo (azul ou rosa) — escolha da pessoa
   ========================================================= */
function aplicarTema(tema) {
  const escolha = tema === 'rosa' ? 'rosa' : 'azul';
  document.body.classList.toggle('tema-rosa', escolha === 'rosa');
  document.body.classList.toggle('tema-azul', escolha === 'azul');

  $$('.tom').forEach(b => b.classList.toggle('ativo', b.dataset.tema === escolha));

  // a cor do navegador (barra do sistema no iPhone)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', escolha === 'rosa' ? '#160a13' : '#0b1220');

  CONFIG.gravar({ tema: escolha });
  return escolha;
}

function ligarEscolhaDeCor() {
  const caixa = $('.escolha-cor');
  if (!caixa) return;
  caixa.addEventListener('click', ev => {
    const botao = ev.target.closest('.tom');
    if (!botao) return;
    const escolha = aplicarTema(botao.dataset.tema);
    aviso(escolha === 'rosa' ? 'Cor rosa ativada.' : 'Cor azul ativada.', 1600);
  });
  aplicarTema(CONFIG.ler().tema || 'azul');
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
  ligarEscolhaDeCor();

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
  $('#btn-nova-pasta').addEventListener('click', () => {
    pedirNome('Nome da pasta', '', valor => {
      const pasta = criarPasta(valor);
      App.pastaAtualId = pasta.id;
      App.paginas = pasta.paginas;
      renderPastas();
      agendarSalvamento();
      aviso(`Pasta "${pasta.nome}" criada. Agora é só digitalizar.`);
    }, ['Contrato', 'Recibo', 'Documentos pessoais', 'Trabalho'], 'Cada pasta vira um documento separado, com as suas folhas.');
  });

  // câmera
  $('#btn-fechar-camera').addEventListener('click', () => { pararCamera(); irPara(App.paginas.length ? 'editor' : 'home'); });
  $('#btn-disparo').addEventListener('click', capturar);
  $('#btn-auto-quadro').addEventListener('click', alternarQuadro);
  $('#btn-flash').addEventListener('click', alternarLanterna);
  $('#btn-auto-crop').addEventListener('click', () => recorteAutomatico(App.paginas));
  $('#btn-ver-paginas').addEventListener('click', () => irPara('editor'));

  // editor
  $('#btn-voltar-home').addEventListener('click', () => { guardarNaPasta(); renderPastas(); irPara('home'); });
  $('#btn-mais').addEventListener('click', abrirCamera);
  $('#btn-limpar').addEventListener('click', limparTudo);
  $('#btn-gerar-pdf').addEventListener('click', gerarPDF);
  $('#btn-fotos').addEventListener('click', abrirFluxoFotos);
  $('#btn-zip').addEventListener('click', enviarTudo);
  $('#btn-separado').addEventListener('click', enviarSeparado);
  $('#btn-renomear-pasta').addEventListener('click', () => {
    const pasta = pastaAtual();
    if (!pasta) return;
    pedirNome('Renomear pasta', pasta.nome, valor => renomearPasta(pasta.id, valor),
      [pasta.nome, 'Contrato', 'Recibo']);
  });
  $('#btn-renomear-tudo').addEventListener('click', renomearTodas);

  // modal de dar nome
  $('#btn-nome-ok').addEventListener('click', confirmarNome);
  $('#btn-nome-cancelar').addEventListener('click', () => { $('#modal-nome').hidden = true; destinoNome = null; });
  $('#campo-nome').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmarNome(); }
  });

  // modal página
  ligarZoomPreview();
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
    else if (btn.dataset.a === 'renomear') renomearFolha(id, i);
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
  renderPastas();
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
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const abertoEm = Date.now();
  navigator.serviceWorker.register('sw.js').then(reg => {
    // procura versão nova TODA vez que o app abre — sem isso, quem já
    // instalou na tela de início pode ficar preso numa versão velha
    reg.update();
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      if (!novo) return;
      novo.addEventListener('statechange', () => {
        if (novo.state !== 'activated' || !navigator.serviceWorker.controller) return;
        // recarrega uma vez, logo na abertura, para a versão nova valer
        if (Date.now() - abertoEm < 12000) location.reload();
        else aviso('Atualização pronta! Feche o app e abra de novo.', 6000);
      });
    });
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', iniciar);