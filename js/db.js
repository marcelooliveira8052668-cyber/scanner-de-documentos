/* =========================================================
   db.js — salvamento automático no próprio aparelho
   ------------------------------------------------------------
   Tudo fica no IndexedDB do navegador (ou seja, no iPhone da
   pessoa). Nada é enviado para servidor nenhum: nem o dev,
   nem o Github, nem a nuvem. Se a pessoa limpar os dados do
   navegador, o que estava salvo é apagado.
   ========================================================= */
'use strict';

const DB = {
  nome: 'scanner-documentos',
  versao: 1,
  _db: null,

  abrir() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.nome, this.versao);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
        if (!db.objectStoreNames.contains('sessao')) db.createObjectStore('sessao');
      };
      req.onsuccess = () => { this._db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  },

  async _transacao(loja, modo, acao) {
    const db = await this.abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(loja, modo);
      const req = acao(tx.objectStore(loja));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /* ---------- configurações (qualidade, filtro, tamanho) ---------- */
  lerConfig() {
    return this._transacao('config', 'readonly', s => s.get('preferencias'))
      .catch(() => null);
  },

  salvarConfig(obj) {
    return this._transacao('config', 'readwrite', s => s.put(obj, 'preferencias'))
      .catch(() => {});
  },

  /* ---------- sessão (páginas em andamento) ---------- */
  lerSessao() {
    return this._transacao('sessao', 'readonly', s => s.get('atual'))
      .catch(() => null);
  },

  salvarSessao(dados) {
    return this._transacao('sessao', 'readwrite', s => s.put(dados, 'atual'))
      .catch(() => {});
  },

  limparSessao() {
    return this._transacao('sessao', 'readwrite', s => s.delete('atual'))
      .catch(() => {});
  },

  /* ---------- uso de espaço ---------- */
  async espaco() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  }
};

/* =========================================================
   Preferências simples (também em localStorage, são fewinhas)
   ========================================================= */
const CONFIG = {
  ler() {
    try { return JSON.parse(localStorage.getItem('scanner-config') || '{}'); }
    catch { return {}; }
  },
  gravar(parcial) {
    const novo = Object.assign(CONFIG.ler(), parcial);
    try { localStorage.setItem('scanner-config', JSON.stringify(novo)); } catch { /* modo anônimo */ }
    return novo;
  }
};