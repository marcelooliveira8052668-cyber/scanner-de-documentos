// Servidor local de desenvolvimento: serve o app e aceita POST /__salvar para inspecionar o PDF gerado.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const RAIZ = process.argv[2] || '.';
const PORTA = Number(process.argv[3] || 8767);
const DESTINO = process.argv[4] || 'teste.pdf';
const PASTA_ZIP = process.argv[5] || '';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  // rota de teste: salva um .zip e descompacta com o proprio Windows
  if (req.method === 'POST' && req.url === '/__salvar-zip') {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const dados = Buffer.concat(partes);
      const destino = join(PASTA_ZIP || '.', 'documentos.zip');
      writeFileSync(destino, dados);
      res.writeHead(200).end('ok ' + dados.length);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/__salvar') {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const dados = Buffer.concat(partes);
      writeFileSync(DESTINO, dados);
      res.writeHead(200).end('ok ' + dados.length);
    });
    return;
  }

  let caminho = decodeURIComponent(req.url.split('?')[0]);
  if (caminho === '/') caminho = '/index.html';
  const arquivo = join(RAIZ, normalize(caminho).replace(/^(\.\.[/\\])+/, ''));
  try {
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  } catch {
    res.writeHead(404).end('nao encontrado');
  }
}).listen(PORTA, '127.0.0.1', () => console.log(`dev server em http://127.0.0.1:${PORTA}/ (raiz: ${RAIZ})`));