/* =========================================================
   pdf.js — cria PDF multipágina embutindo JPEGs
   Sem bibliotecas externas: funciona 100% offline.
   ========================================================= */
'use strict';

const TAM_A4 = { w: 595.28, h: 841.89 };
const TAM_CARTA = { w: 612, h: 792 };

/**
 * Monta o PDF.
 * @param {{bytes:Uint8Array,width:number,height:number,rotation:number}[]} paginas
 * @param {{modo?:'a4'|'carta'|'foto', titulo?:string, autor?:string}} opcoes
 * @returns {Blob}
 */
function montarPDF(paginas, opcoes = {}) {
  const modo = opcoes.modo || 'a4';
  const enc = new TextEncoder();
  const partes = [];
  let tam = 0;
  const offsets = [0];

  const escrever = (bytes) => {
    const b = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
    partes.push(b);
    tam += b.length;
  };
  const obj = (num, corpo) => {
    offsets[num] = tam;
    escrever(`${num} 0 obj\n`);
    escrever(corpo);
    escrever('\nendobj\n');
  };

  // cabeçalho com marca binária (identifica o arquivo como PDF)
  escrever(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const n = paginas.length;
  const totalObjs = 2 + n * 3 + 1;      // catálogo, páginas, 3 por página, informações
  const numPagina = i => 3 + i * 3;    // numeração: 3, 6, 9...
  const numConteudo = i => 4 + i * 3;
  const numImagem = i => 5 + i * 3;
  const numInfo = 2 + n * 3 + 1;

  // --- objeto 1: catálogo ---
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  // --- objeto 2: árvore de páginas ---
  const kids = paginas.map((_, i) => `${numPagina(i)} 0 R`).join(' ');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);

  // --- páginas ---
  paginas.forEach((img, i) => {
    const m = geometriaPagina(img, modo);
    const pW = m.pagW.toFixed(2), pH = m.pagH.toFixed(2);
    obj(numPagina(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pW} ${pH}] ` +
      `/Resources << /XObject << /Im0 ${numImagem(i)} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
      `/Contents ${numConteudo(i)} 0 R >>`);

    const fluxo = `q\n${m.matriz.join(' ')} cm\n/Im0 Do\nQ\n`;
    obj(numConteudo(i), `<< /Length ${fluxo.length} >>\nstream\n${fluxo}endstream`);

    // objeto de imagem: precisa escrever bytes crus (o JPEG) no meio
    offsets[numImagem(i)] = tam;
    escrever(`${numImagem(i)} 0 obj\n<< /Type /XObject /Subtype /Image ` +
      `/Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Interpolate true ` +
      `/Length ${img.bytes.length} >>\nstream\n`);
    escrever(img.bytes);
    escrever('\nendstream\nendobj\n');
  });

  // --- informações do arquivo ---
  const d = new Date();
  const p2 = n2 => String(n2).padStart(2, '0');
  const data = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  obj(numInfo,
    `<< /Title (${txtPdf(opcoes.titulo || 'Documento digitalizado')}) ` +
    `/Producer (Scanner de Documentos) /Creator (Scanner de Documentos) ` +
    `/CreationDate (${data}) >>`);

  // --- xref ---
  const posXref = tam;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  xref += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${numInfo} 0 R >>\nstartxref\n${posXref}\n%%EOF\n`;
  escrever(xref);

  return new Blob(partes, { type: 'application/pdf' });
}

/** Texto seguro para objetos de string do PDF (ASCII + escapes). */
function txtPdf(s) {
  return String(s).replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Calcula o tamanho da página do PDF e a matriz que coloca a imagem
 * (já considerando a rotação) no lugar certo.
 */
function geometriaPagina(img, modo) {
  const rot = ((img.rotation || 0) % 360 + 360) % 360;
  const troca = rot === 90 || rot === 270;
  const wPx = img.width, hPx = img.height;          // imagem como guardada
  const iw = troca ? hPx : wPx;                     // imagem já girada
  const ih = troca ? wPx : hPx;

  let pagW, pagH, drawW, drawH, x, y;

  if (modo === 'foto') {
    const s = 72 / 96;                              // px -> pt (96 dpi)
    drawW = iw * s;
    drawH = ih * s;
    pagW = drawW;
    pagH = drawH;
    x = 0; y = 0;
  } else {
    const tam = modo === 'carta' ? TAM_CARTA : TAM_A4;
    pagW = tam.w;
    pagH = tam.h;
    const s = Math.min(pagW / iw, pagH / ih);
    drawW = iw * s;
    drawH = ih * s;
    x = (pagW - drawW) / 2;
    y = (pagH - drawH) / 2;
  }

  // Matriz de transformação: mapeia o quadrado unitário da imagem na página.
  // u = eixo horizontal da imagem (0 = esquerda), v = eixo vertical (0 = cima)
  let a, b, c, d, e, f;
  switch (rot) {
    case 90:
      a = 0; c = -drawW; e = x + drawW;
      b = -drawH; d = 0; f = y + drawH;
      break;
    case 180:
      a = -drawW; c = 0; e = x + drawW;
      b = 0; d = drawH; f = y + drawH;
      break;
    case 270:
      a = 0; c = drawW; e = x;
      b = drawH; d = 0; f = y;
      break;
    default:
      a = drawW; c = 0; e = x;
      b = 0; d = drawH; f = y;
      break;
  }

  // converte de (u,v com v para baixo) para o espaço do PDF (V para cima)
  const A = a, B = b, C = -c, D = -d, E = c + e, F = d + f;

  return {
    pagW, pagH,
    matriz: [A, B, C, D, E, F].map(n => (Math.abs(n) < 1e-6 ? 0 : +n.toFixed(4)))
  };
}

