/* Gera o QR Code do endereço do app em PNG, usando a mesma biblioteca que o app usa.
   Uso: node tools/gerar-qr.mjs [url]
   Saida: qrcode-acesso.png (na raiz do projeto)
*/
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_APP = process.argv[2] || 'https://marcelooliveira8052668-cyber.github.io/scanner-de-documentos/';

const require = createRequire(import.meta.url);
const qrcode = require(join(RAIZ, 'js/vendor/qrcode.js'));

const qr = qrcode(0, 'M');
qr.addData(URL_APP);
qr.make();

const modulos = qr.getModuleCount();
const margem = 4;
const total = modulos + margem * 2;
const ESCALA = 8;
const lado = total * ESCALA;

/* --- imagem RGBA --- */
const px = Buffer.alloc(lado * lado * 4, 0xff);   // fundo branco opaco
for (let linha = 0; linha < modulos; linha++) {
  for (let col = 0; col < modulos; col++) {
    if (!qr.isDark(linha, col)) continue;
    const x0 = (col + margem) * ESCALA;
    const y0 = (linha + margem) * ESCALA;
    for (let y = y0; y < y0 + ESCALA; y++) {
      let i = (y * lado + x0) * 4;
      for (let x = 0; x < ESCALA; x++) {
        px[i] = 0x0b; px[i + 1] = 0x12; px[i + 2] = 0x20; px[i + 3] = 0xff;
        i += 4;
      }
    }
  }
}

/* --- PNG --- */
const tabelaCrc = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (tipo, dados) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(lado, 0);
ihdr.writeUInt32BE(lado, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const linhas = Buffer.alloc((lado * 4 + 1) * lado);
for (let y = 0; y < lado; y++) {
  const base = y * (lado * 4 + 1);
  linhas[base] = 0;
  px.copy(linhas, base + 1, y * lado * 4, (y + 1) * lado * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(linhas, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const saida = join(RAIZ, 'qrcode-acesso.png');
writeFileSync(saida, png);
console.log(`OK ${saida}`);
console.log(`   endereco: ${URL_APP}`);
console.log(`   tamanho: ${lado}x${lado} px, ${(png.length / 1024).toFixed(1)} KB`);
console.log(`   modulos: ${modulos}x${modulos}`);