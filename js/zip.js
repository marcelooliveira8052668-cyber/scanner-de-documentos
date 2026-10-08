/* =========================================================
   zip.js — monta um arquivo .zip (só storing, sem compressão)
   ------------------------------------------------------------
   PDF já vem comprimido por dentro, então não adianta
   comprimir de novo: guardamos os bytes como estão. O
   resultado é um .zip que qualquer celular abre — inclusive o
   WhatsApp, que mostra como um único arquivo.
   ========================================================= */
'use strict';

/* ---------- CRC32 (necessário para o formato .zip) ---------- */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- data/hora no formato do DOS (usado pelo zip) ---------- */
function dataHoraDos(d) {
  const hora = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const data = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { hora, data };
}

function limparNome(nome) {
  return String(nome)
    .replace(/[\\/:*?"<>|]/g, '-')      // caracteres proibidos no zip
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'arquivo';
}

function nomeUnico(nome, usados) {
  let n = limparNome(nome);
  if (!usados.has(n)) { usados.add(n); return n; }
  const ponto = n.lastIndexOf('.');
  const base = ponto > 0 ? n.slice(0, ponto) : n;
  const ext = ponto > 0 ? n.slice(ponto) : '';
  let i = 2;
  while (usados.has(`${base} (${i})${ext}`)) i++;
  const final = `${base} (${i})${ext}`;
  usados.add(final);
  return final;
}

/**
 * Cria o .zip.
 * @param {{nome:string, bytes:Uint8Array, pasta?:string}[]} arquivos
 * @param {Date} quando
 * @returns {Blob} application/zip
 */
function criarZip(arquivos, quando = new Date()) {
  const usados = new Set();
  const { hora, data } = dataHoraDos(quando);
  const encoder = new TextEncoder();
  const partes = [];
  const central = [];
  let offset = 0;

  for (const arq of arquivos) {
    const bytes = arq.bytes;
    const nomeCompleto = arq.pasta ? `${limparNome(arq.pasta)}/${nomeUnico(arq.nome, usados)}` : nomeUnico(arq.nome, usados);
    const nomeBytes = encoder.encode(nomeCompleto);
    const crc = crc32(bytes);

    // ---- cabeçalho local ----
    const local = new Uint8Array(30 + nomeBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);        // versão necessária
    dv.setUint16(6, 0x0800, true);    // flag: nome em UTF-8
    dv.setUint16(8, 0, true);         // compressão: storing
    dv.setUint16(10, hora, true);
    dv.setUint16(12, data, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, bytes.length, true);
    dv.setUint32(22, bytes.length, true);
    dv.setUint16(26, nomeBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nomeBytes, 30);

    // ---- registro no diretório central ----
    const dir = new Uint8Array(46 + nomeBytes.length);
    const dd = new DataView(dir.buffer);
    dd.setUint32(0, 0x02014b50, true);
    dd.setUint16(4, 20, true);        // versão do criador
    dd.setUint16(6, 20, true);        // versão necessária
    dd.setUint16(8, 0x0800, true);
    dd.setUint16(10, 0, true);
    dd.setUint16(12, hora, true);
    dd.setUint16(14, data, true);
    dd.setUint32(16, crc, true);
    dd.setUint32(20, bytes.length, true);
    dd.setUint32(24, bytes.length, true);
    dd.setUint16(28, nomeBytes.length, true);
    dd.setUint16(30, 0, true);        // extra
    dd.setUint16(32, 0, true);        // comentário
    dd.setUint16(34, 0, true);        // disco
    dd.setUint16(36, 0, true);        // atributos internos
    dd.setUint32(38, 0, true);        // atributos externos
    dd.setUint32(42, offset, true);   // deslocamento do cabeçalho local
    dir.set(nomeBytes, 46);

    partes.push(local, bytes);
    central.push(dir);
    offset += local.length + bytes.length;
  }

  const tamanhoCentral = central.reduce((s, d) => s + d.length, 0);

  // ---- fim do diretório central ----
  const fim = new Uint8Array(22);
  const df = new DataView(fim.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(4, 0, true);
  df.setUint16(6, 0, true);
  df.setUint16(8, central.length, true);
  df.setUint16(10, central.length, true);
  df.setUint32(12, tamanhoCentral, true);
  df.setUint32(16, offset, true);
  df.setUint16(20, 0, true);

  return new Blob([...partes, ...central, fim], { type: 'application/zip' });
}