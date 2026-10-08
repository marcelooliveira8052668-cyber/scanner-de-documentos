/* =========================================================
   filters.js — tratamento de imagem para escaneamento
   (melhora de contraste, cinza, alto contraste e recorte automático)
   ========================================================= */
'use strict';

/* ------------------------------------------------------------
   1) Ajuste automático de níveis (tira o amarelo, clareia o papel)
   ------------------------------------------------------------ */
function niveisLuminosidade(dados, w, h) {
  const hist = new Uint32Array(256);
  const passo = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  let total = 0;
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = (y * w + x) << 2;
      const l = (dados[i] * 0.299 + dados[i + 1] * 0.587 + dados[i + 2] * 0.114) | 0;
      hist[l]++;
      total++;
    }
  }
  const p = (frac) => {
    let acc = 0;
    const alvo = total * frac;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= alvo) return v;
    }
    return 255;
  };
  const baixo = p(0.02);
  const alto = p(0.98);

  // Imagem chapada (pouco contraste) ou faixa muito estreita: não estica nada,
  // senão o ajuste escurece a cada reaplicação e a página vira um bloco cinza.
  if (alto - baixo < 40) return null;

  return { baixo, alto };
}

/**
 * Aplica um filtro de escaneamento.
 * @param {HTMLCanvasElement} origem
 * @param {'auto'|'color'|'gray'|'contrast'} filtro
 */
function aplicarFiltro(origem, filtro) {
  if (filtro === 'original') return origem;

  const c = novoCanvas(origem.width, origem.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(origem, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const w = c.width, h = c.height;

  if (filtro === 'color') {
    // saturação leve + contraste suave, preservando as cores
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i]     = clamp(128 + (d[i] - 128) * 1.14 + (d[i] - l) * 0.14, 0, 255);
      d[i + 1] = clamp(128 + (d[i + 1] - 128) * 1.14 + (d[i + 1] - l) * 0.14, 0, 255);
      d[i + 2] = clamp(128 + (d[i + 2] - 128) * 1.14 + (d[i + 2] - l) * 0.14, 0, 255);
    }
  } else {
    const niveis = niveisLuminosidade(d, w, h);
    if (!niveis) {
      // sem contraste aproveitável: devolve a imagem como está (só em tons de cinza)
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        d[i] = l; d[i + 1] = l; d[i + 2] = l;
      }
      ctx.putImageData(img, 0, 0);
      return c;
    }

    const { baixo, alto } = niveis;
    const faixa = Math.max(1, alto - baixo);
    const forca = filtro === 'contrast' ? 1.0 : 0.85;
    const gama = filtro === 'contrast' ? 1.12 : 1.0;

    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      // estica a faixa entre o ponto preto e o ponto branco
      let v = clamp((l - baixo) * (255 / faixa), 0, 255);
      // amacia o esticamento para não estourar as sombras
      v = baixo * (1 - forca) + v * forca;
      // curva de contraste
      if (gama !== 1) v = 255 * Math.pow(v / 255, gama);
      const c8 = clamp(v, 0, 255) | 0;
      d[i] = c8; d[i + 1] = c8; d[i + 2] = c8;
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------
   2) Detecção das bordas do papel (recorte automático)
   ------------------------------------------------------------ */
/**
 * Procura o retângulo do documento numa foto de página.
 * Usa limiar de Otsu + maior componente claro.
 * @returns {{x:number,y:number,w:number,h:number}|null} em pixels da imagem
 */
function detectarBordas(origem) {
  const L = 180;
  const w = L;
  const h = Math.max(60, Math.round(L * (origem.height / origem.width)));
  const mini = novoCanvas(w, h);
  const ctx = mini.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(origem, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // --- Otsu ---
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    lum[p] = v;
    hist[v]++;
  }
  const soma = (a, b) => {
    let s = 0;
    for (let v = a; v <= b; v++) s += v * hist[v];
    return s;
  };
  let limiar = 128, melhorVar = -1;
  for (let t = 0; t < 256; t++) {
    const n1 = soma(0, t);
    const n2 = soma(t + 1, 255);
    if (n1 === 0 || n2 === 0) continue;
    const m1 = n1 / (t + 1);
    const m2 = n2 / (255 - t);
    const v = n1 * n2 * (m1 - m2) * (m1 - m2);
    if (v > melhorVar) { melhorVar = v; limiar = t; }
  }

  // --- máscara do papel ---
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) mask[p] = lum[p] > limiar ? 1 : 0;

  // --- maior componente claro (busca em largura) ---
  const rotulo = new Int32Array(w * h).fill(-1);
  const fila = new Int32Array(w * h);
  let rot = -1, rotVencedor = -1, areaVencedora = 0;
  for (let ini = 0; ini < mask.length; ini++) {
    if (!mask[ini] || rotulo[ini] !== -1) continue;
    const id = ++rot;
    let cab = 0, cal = 0, area = 0;
    fila[cal++] = ini;
    rotulo[ini] = id;
    while (cab < cal) {
      const p = fila[cab++];
      const x = p % w, y = (p / w) | 0;
      area++;
      const viz = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of viz) {
        if (q >= 0 && mask[q] && rotulo[q] === -1) { rotulo[q] = id; fila[cal++] = q; }
      }
    }
    if (area > areaVencedora) { areaVencedora = area; rotVencedor = id; }
  }

  const frac = areaVencedora / (w * h);

  // folha ocupando quase todo o quadro: em vez de desistir, corta só as bordas
  if (frac >= 0.97) {
    const m = 0.035;
    return {
      x: origem.width * m, y: origem.height * m,
      w: origem.width * (1 - 2 * m), h: origem.height * (1 - 2 * m)
    };
  }

  // papel pequeno demais (luz fraca, folha longe demais): não tem o que cortar
  if (frac < 0.10) return null;

  // --- caixa envolvente do componente vencedor ---
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rotulo[y * w + x] === rotVencedor) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const fx = origem.width / w;
  const fy = origem.height / h;
  // margem pequena: tira só a transição da borda, sem comer o papel
  const margem = 0.012;
  const x = clamp((minX + w * margem) * fx, 0, origem.width - 1);
  const y = clamp((minY + h * margem) * fy, 0, origem.height - 1);
  const x2 = clamp((maxX - w * margem + 1) * fx, x + 8, origem.width);
  const y2 = clamp((maxY - h * margem + 1) * fy, y + 8, origem.height);

  // descarta detecções degeneradas
  if (x2 - x < origem.width * 0.2 || y2 - y < origem.height * 0.2) return null;

  return { x, y, w: x2 - x, h: y2 - y };
}