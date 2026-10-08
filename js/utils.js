/* =========================================================
   utils.js — utilidades gerais
   ========================================================= */
'use strict';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------- avisos rápidos ---------- */
function aviso(msg, ms = 2800) {
  const alvo = $('#brindes');
  const el = document.createElement('div');
  el.className = 'brinde';
  el.textContent = msg;
  alvo.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ---------- tela de carregamento ---------- */
function carregando(ligar, texto = 'Processando…') {
  $('#carregando-txt').textContent = texto;
  $('#carregando').hidden = !ligar;
}

async function comCarregando(texto, fn) {
  carregando(true, texto);
  await new Promise(r => setTimeout(r, 30)); // deixa a tela pintar
  try {
    return await fn();
  } finally {
    carregando(false);
  }
}

/* ---------- imagens ---------- */
function carregarImagem(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler a imagem.')); };
    img.src = url;
  });
}

function novoCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Cria um canvas com a imagem redimensionada para caber em maxDim (sem ampliar). */
function canvasLimitado(img, maxDim) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const escala = Math.min(1, maxDim / Math.max(w, h));
  const c = novoCanvas(w * escala, h * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function canvasParaBlob(canvas, tipo = 'image/jpeg', qualidade = 0.9) {
  return new Promise(resolve => {
    if (canvas.toBlob) canvas.toBlob(b => resolve(b), tipo, qualidade);
    else {
      const data = canvas.toDataURL(tipo, qualidade);
      resolve(dataURLparaBlob(data));
    }
  });
}

function dataURLparaBlob(dataURL) {
  const partes = dataURL.split(',');
  const mime = /:(.*?);/.exec(dataURL)[1];
  const bin = atob(partes[partes.length - 1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Rotaciona um canvas em 90/180/270 graus devolvendo um novo canvas. */
function rotacionarCanvas(canvas, graus) {
  const d = ((graus % 360) + 360) % 360;
  if (d === 0) return canvas;
  const troca = d === 90 || d === 270;
  const c = novoCanvas(troca ? canvas.height : canvas.width, troca ? canvas.width : canvas.height);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

/** Recorta um canvas para o retângulo informado (em pixels do próprio canvas). */
function recortarCanvas(canvas, rect) {
  const x = clamp(Math.round(rect.x), 0, canvas.width);
  const y = clamp(Math.round(rect.y), 0, canvas.height);
  const w = clamp(Math.round(rect.w), 1, canvas.width - x);
  const h = clamp(Math.round(rect.h), 1, canvas.height - y);
  const c = novoCanvas(w, h);
  c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c;
}

/* ---------- arquivos ---------- */
function baixar(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function nomeComData(prefixo, extensao) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${prefixo}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${extensao}`;
}

/** Compartilha um arquivo; se não suportar, baixa. */
async function compartilharArquivo(blob, nomeArquivo, titulo) {
  const arquivo = new File([blob], nomeArquivo, { type: blob.type });
  const podeCompartilhar = navigator.canShare && navigator.canShare({ files: [arquivo] });
  if (navigator.share && podeCompartilhar) {
    try {
      await navigator.share({ files: [arquivo], title: titulo || nomeArquivo });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // usuário cancelou
      // cai para download
    }
  }
  baixar(blob, nomeArquivo);
  return false;
}

function ehApple() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}