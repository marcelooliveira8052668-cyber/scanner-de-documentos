// Validador de PDF: confere estrutura, xref e extrai as imagens embutidas.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arq = process.argv[2];
const saida = process.argv[3] || '.';
const buf = readFileSync(arq);
const txt = buf.toString('latin1');

console.log(`arquivo: ${arq} (${buf.length} bytes)`);
console.log(`cabecalho: ${JSON.stringify(txt.slice(0, 9))}`);

// --- fim de arquivo ---
const posEof = txt.lastIndexOf('%%EOF');
console.log(`%%EOF encontrado: ${posEof > 0 ? 'sim' : 'NAO'}`);

// --- startxref ---
const m = txt.match(/startxref\s+(\d+)\s+%%EOF/);
if (!m) { console.log('startxref AUSENTE -> PDF invalido'); process.exit(1); }
const posXref = Number(m[1]);
console.log(`startxref aponta para: ${posXref}`);
console.log(`  conteudo la: ${JSON.stringify(txt.slice(posXref, posXref + 12))}`);

// --- tabela xref (entadas de 20 bytes, como manda o formato) ---
const area = txt.slice(posXref);
if (area.slice(0, 4) !== 'xref') { console.log('XREF: palavra "xref" ausente'); process.exit(1); }
const quebraLinha = area.indexOf('\n');              // fim da palavra "xref"
const inicioLista = quebraLinha + 1;
const fimLista = area.indexOf('\n', inicioLista);     // fim da linha "0 N"
const cabecalho = area.slice(inicioLista, fimLista).trim().split(/\s+/).map(Number);
const primeiro = cabecalho[0];
const quantos = cabecalho[1];
if (!Number.isFinite(quantos)) { console.log('XREF: cabeçalho ilegível: ' + JSON.stringify(area.slice(0, 30))); process.exit(1); }
console.log(`objetos declarados: ${quantos} (ids ${primeiro}..${primeiro + quantos - 1})`);

const tabela = area.slice(fimLista + 1, fimLista + 1 + quantos * 20);
console.log(`tabela tem ${tabela.length} bytes (esperado ${quantos * 20})`);

let erros = 0;
for (let k = 0; k < quantos; k++) {
  const entrada = tabela.slice(k * 20, k * 20 + 20);
  const id = primeiro + k;
  const offset = Number(entrada.slice(0, 10));
  const tipo = entrada.slice(17, 18);
  if (entrada.length !== 20) { console.log(`  entrada ${k}: tamanho ${entrada.length}`); erros++; continue; }
  if (id === 0) { console.log('  entrada 0 (livre): ok'); continue; }
  const esperado = `${id} 0 obj`;
  if (txt.slice(offset, offset + esperado.length) !== esperado) {
    console.log(`  objeto ${id}: offset ${offset} nao aponta para "${esperado}" -> ${JSON.stringify(txt.slice(offset, offset + 16))}`);
    erros++;
  }
  if (tipo !== 'n') { console.log(`  objeto ${id}: tipo "${tipo}" (deveria ser n)`); erros++; }
}
console.log(erros ? `XREF: ${erros} problema(s)` : `XREF: ok, ${quantos - 1} objetos com offset correto`);

// --- paginas e imagens ---
const paginas = (txt.match(/\/Type \/Page[^s]/g) || []).length;
const imagens = (txt.match(/\/Subtype \/Image/g) || []).length;
const dct = (txt.match(/\/Filter \/DCTDecode/g) || []).length;
console.log(`paginas: ${paginas} | imagens: ${imagens} | jpeg embutidos: ${dct}`);

const caixas = [...txt.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(x => x[1].trim());
console.log(`MediaBox: ${JSON.stringify(caixas)}`);

// --- extrai os JPEGs para confericao visual ---
mkdirSync(saida, { recursive: true });
const re = /stream\r?\n/g;
let mImg, n = 0;
const filtro = /\/Subtype \/Image[^]*?\/Length (\d+) >>\s*\nstream\r?\n/g;
while ((mImg = filtro.exec(txt))) {
  const ini = mImg.index + mImg[0].length;
  const tam = Number(mImg[1]);
  const jpeg = buf.subarray(ini, ini + tam);
  const okJpeg = jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9;
  const arq2 = `${saida}/pagina-${++n}.jpg`;
  writeFileSync(arq2, jpeg);
  console.log(`  ${arq2}: ${tam} bytes, JPEG valido: ${okJpeg ? 'sim' : 'NAO'}`);
  re.lastIndex = ini + tam;
}
console.log(n ? `extrai ${n} imagem(ns) para inspecao visual` : 'NENHUMA imagem extraida');