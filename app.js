
/* =========================================================
   Enquadramento automático ao vivo
   ------------------------------------------------------------
   A câmera procura a folha a cada instante, desenha um guia
   que se ajusta no papel e já entrega a foto recortada.
   ========================================================= */
const Quadro = {
  ativo: true,          // Ligado/desligado pelo botão do topo (ícone de grade/quadro)
  ret: null,            // Guarda as coordenadas { x, y, w, h } em pixels da imagem canônica
  anterior: null,       // Armazena a detecção anterior para medir a estabilidade da folha
  estavel: 0,           // Conta quantas leituras seguidas a folha ficou parada/estável
  animando: false,
  ultimaTentativa: 0,
  ultimoAcerto: 0,      // Momento em que a folha foi detectada por último (em milissegundos)
  provissorio: false    // True = guia estimado por padrão, ainda não encontrou o papel com exatidão
};

// Intervalo em milissegundos entre cada leitura da câmera (menor = mais rápido; maior = economiza bateria do celular)
const INTERVALO_DETECCAO = 130;   
// Largura da miniatura reduzida que é analisada para não travar o processamento do celular
const LARGURA_DETECCAO = 170;    

/** Mede o vídeo da câmera e verifica se a orientação está deitada (comum em alguns celulares). */
function geometriaVideo(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const r = video.getBoundingClientRect();
  const emPe = r.height > r.width;
  const deitado = vw > vh;
  const girar = deitado && emPe;
  return {
    vw, vh,
    largura: girar ? vh : vw,    // Largura padronizada da imagem salva pelo app
    altura: girar ? vw : vh,
    girar
  };
}

/** Converte as coordenadas de um ponto do vídeo para a imagem canônica com o giro aplicado. */
function pontoParaCanonico(px, py, geo) {
  return geo.girar ? { x: geo.vh - py, y: px } : { x: px, y: py };
}

/** Converte um ponto canônico de volta para as coordenadas exibidas no vídeo. */
function pontoParaVideo(cx, cy, geo) {
  return geo.girar ? { x: cy, y: geo.vh - cx } : { x: cx, y: cy };
}

/** Mapeia a imagem do vídeo para o tamanho real da tela do celular, respeitando o ajuste de proporção. */
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

/** Inicia o loop contínuo de leitura e monitoramento da câmera. */
function ligarDeteccao() {
  Quadro.ret = null;
  Quadro.anterior = null;
  Quadro.estavel = 0;
  Quadro.animando = true;
  if (Quadro.raf) cancelAnimationFrame(Quadro.raf);
  quadroLaco();
}

function desligarDeteccao() {
  Quadro.animando = false;
  if (Quadro.raf) cancelAnimationFrame(Quadro.raf);
  Quadro.raf = null;
  Quadro.ret = null;
  const el = $('#estado-quadro');
  if (el) el.hidden = true;
}

/** Loop principal executado a cada frame para buscar a folha e atualizar o desenho na tela. */
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

  // Cria uma miniatura leve para o algoritmo analisar rapidamente as bordas
  const escala = LARGURA_DETECCAO / geo.vw;
  const mini = Quadro.mini || (Quadro.mini = novoCanvas(1, 1));
  mini.width = LARGURA_DETECCAO;
  mini.height = Math.max(1, Math.round(geo.vh * escala));
  const ctx = mini.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(video, 0, 0, mini.width, mini.height);
  } catch { return; }

  // Executa a detecção de bordas na miniatura
  const det = detectarBordas(mini);
  if (!det) {
    // Se perder a folha por um instante, segura o último retângulo por milissegundos para a tela não piscar
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

  // Trava os limites do retângulo dentro da área da imagem
  rect.x = clamp(rect.x, 0, geo.largura);
  rect.y = clamp(rect.y, 0, geo.altura);
  rect.w = clamp(rect.w, 10, geo.largura - rect.x);
  rect.h = clamp(rect.h, 10, geo.altura - rect.y);

  // Valida se a folha está estável na mesma posição (evita disparos falsos com o movimento da mão)
  const ant = Quadro.anterior;
  if (ant && Math.abs(ant.x - rect.x) < geo.largura * 0.02 &&
      Math.abs(ant.y - rect.y) < geo.altura * 0.02 &&
      Math.abs(ant.w - rect.w) < geo.largura * 0.02 &&
      Math.abs(ant.h - rect.h) < geo.altura * 0.02) {
    Quadro.estavel = Math.min(Quadro.estavel + 1, 4); // Aumenta o nível de estabilidade
  } else {
    Quadro.estavel = 0; // Reinicia se houver muito movimento
  }
  Quadro.anterior = rect;
  Quadro.ret = rect;
  Quadro.ultimoAcerto = agora;
  Quadro.provisorio = false;

  // Se a estabilidade atingir 2 ou mais leituras seguidas, considera a folha enquadrada
  marcarEstado(Quadro.estavel >= 2 ? 'Folha enquadrada ✓' : 'Ajustando…', Quadro.estavel >= 2);
  desenharGuia(video, geo, tela, rect);
}

/** Desenha o guia visual na tela: escurece o fundo ao redor e destaca as bordas do papel. */
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

  // 1) Escurece tudo o que está fora da folha para dar foco no papel
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, .45)';
  ctx.beginPath();
  ctx.rect(0, 0, c.width, c.height);

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

  // 2) Desenha a borda ao redor da folha:
  // - Fica VERDE (#22c07a) quando a folha está estável e enquadrada!
  // - Fica tracejada ou amarela enquanto for apenas uma estimativa buscando o papel.
  const pronto = Quadro.estavel >= 2 && !Quadro.provisorio;
  ctx.save();
  ctx.lineWidth = 3; // Espessura da linha da moldura na tela
  if (Quadro.provisorio) ctx.setLineDash([12, 9]);
  
  // Definição da cor da borda baseada no estado de enquadramento
  ctx.strokeStyle = pronto ? '#22c07a' : (Quadro.provisorio ? 'rgba(255,209,102,.95)' : 'rgba(255,255,255,.92)');
  
  ctx.shadowColor = pronto ? 'rgba(34,192,122,.8)' : 'rgba(0,0,0,.5)';
  ctx.shadowBlur = pronto ? 14 : 6;
  ctx.beginPath();
  ctx.moveTo(cantos[0][0], cantos[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(cantos[i][0], cantos[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}