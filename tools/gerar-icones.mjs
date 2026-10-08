/* Gera os icones PNG do app (sem dependencias externas).
   Uso: node tools/gerar-icones.mjs
*/
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'icons');
mkdirSync(SAIDA, { recursive: true });

/* ---------- PNG ---------- */
const tabelaCrc = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // 8 bits por canal
  ihdr[9] = 6;    // RGBA
  const linhas = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (width * 4 + 1);
    linhas[base] = 0; // filtro "none"
    rgba.copy(linhas, base + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(linhas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- cores ---------- */
const misturar = (a, b, t) => a + (b - a) * t;
const gradiente = (c1, c2, t) => [
  Math.round(misturar(c1[0], c2[0], t)),
  Math.round(misturar(c1[1], c2[1], t)),
  Math.round(misturar(c1[2], c2[2], t)),
  255
];

const AZUL_CLARO = [0x4a, 0x94, 0xff];
const AZUL_ESCURO = [0x11, 0x42, 0xb0];
const PAPEL = [0xff, 0xff, 0xff];
const PAPEL_DOBRA = [0xd9, 0xe6, 0xfb];
const TEXTO = [0x8f, 0xae, 0xd9];
const MARCA = [0x2f, 0x7d, 0xff];

/* ---------- desenho (coordenadas normalizadas 0..1) ---------- */
function dentroRetangulo(u, v, x0, y0, x1, y1) {
  return u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

/**
 * Cor de um ponto do ícone.
 * @param {number} margem espaço extra reservado nas bordas (0..0.3)
 */
function corEm(u, v, margem) {
  // --- fundo arredondado ---
  const r = 0.215;
  const qx = Math.abs(u - 0.5) - (0.5 - r);
  const qy = Math.abs(v - 0.5) - (0.5 - r);
  const fora = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) - r;
  if (fora > 0) return [0, 0, 0, 0];
  let rgba = gradiente(AZUL_CLARO, AZUL_ESCURO, (u * 0.55 + v * 0.45));

  // --- folha de papel ---
  const x0 = margem + 0.10, x1 = 1 - margem - 0.10;
  const y0 = margem + 0.135, y1 = 1 - margem - 0.135;
  const pw = x1 - x0, ph = y1 - y0;
  const dentroPapel = dentroRetangulo(u, v, x0, y0, x1, y1);

  if (dentroPapel) {
    // canto superior direito dobrado
    const dobra = pw * 0.26;
    const dobrado = u > x1 - dobra && v < y0 + dobra &&
      (u - (x1 - dobra) + (y0 + dobra - v)) > dobra;
    rgba = dobrado ? PAPEL_DOBRA : PAPEL;

    // linhas de texto
    if (!dobrado) {
      const alturas = [0.34, 0.50, 0.66, 0.82];
      for (const p of alturas) {
        const larguraLinha = pw * (p > 0.8 ? 0.46 : 0.76);
        if (v > y0 + ph * (p - 0.035) && v < y0 + ph * (p + 0.035) &&
            u > x0 + pw * 0.12 && u < x0 + larguraLinha) {
          rgba = TEXTO;
        }
      }
    }
  }

  // --- cantoneiras de "scan" sobre o papel ---
  const comp = pw * 0.17;      // comprimento do braço
  const esp = ph * 0.013;     // espessura
  const recuoX = pw * 0.055, recuoY = ph * 0.055;
  for (const [px, py, sx, sy] of [
    [x0 + recuoX, y0 + recuoY, 1, 1],
    [x1 - recuoX, y0 + recuoY, -1, 1],
    [x0 + recuoX, y1 - recuoY, 1, -1],
    [x1 - recuoX, y1 - recuoY, -1, -1]
  ]) {
    const horiz = Math.abs(v - py) < esp &&
      u > Math.min(px, px + sx * comp) && u < Math.max(px, px + sx * comp);
    const vert = Math.abs(u - px) < esp &&
      v > Math.min(py, py + sy * comp * 0.62) && v < Math.max(py, py + sy * comp * 0.62);
    if (dentroPapel && (horiz || vert)) rgba = MARCA;
  }

  return rgba;
}

/** Renderiza com supersampling 3x3 para ficar lisinho. */
function desenhar(tam, margem) {
  const px = Buffer.alloc(tam * tam * 4);
  const SS = 3;
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / tam;
          const v = (y + (sy + 0.5) / SS) / tam;
          const c = corEm(u, v, margem);
          const alfa = c[3] / 255;
          r += c[0] * alfa; g += c[1] * alfa; b += c[2] * alfa; a += alfa;
        }
      }
      const total = SS * SS;
      const i = (y * tam + x) * 4;
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return png(tam, tam, px);
}

const alvos = [
  ['icon-180.png', 180, 0.02],
  ['icon-192.png', 192, 0.02],
  ['icon-512.png', 512, 0.02],
  ['icon-maskable-512.png', 512, 0.12]   // margem maior: o iOS recorta as bordas
];

for (const [nome, tam, margem] of alvos) {
  const buf = desenhar(tam, margem);
  writeFileSync(join(SAIDA, nome), buf);
  console.log(`OK ${nome} (${tam}x${tam}, ${(buf.length / 1024).toFixed(1)} KB)`);
}