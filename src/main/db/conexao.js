import Database from 'better-sqlite3';
import { migrar } from './migrar.js';

let db = null;

/**
 * Abre (ou cria) o banco, aplica PRAGMAs e roda as migrações pendentes.
 * Uma única conexão para todo o processo main — o renderer nunca fala com o
 * SQLite direto.
 *
 * @param {string} caminho caminho do arquivo, ou ':memory:' nos testes
 */
export function abrirBanco(caminho, { log = console } = {}) {
  db = new Database(caminho);

  db.pragma('journal_mode = WAL');
  // Loja de bairro raramente tem nobreak: FULL custa alguns ms por commit e
  // garante que uma venda confirmada sobrevive a um desligamento na tomada.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const r = migrar(db, { log });
  if (r.aplicadas.length) log.info?.(`Banco migrado da versão ${r.de} para ${r.para}`);

  return db;
}

/** Conexão já aberta. Lança se abrirBanco() ainda não rodou. */
export function obterBanco() {
  if (!db) throw new Error('Banco não inicializado. Chame abrirBanco() antes.');
  return db;
}

export function fecharBanco() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Envolve uma função numa transação. Usar para toda operação que grava em mais
 * de uma tabela — finalizar venda, cancelar, fechar caixa, importar.
 */
export function emTransacao(fn) {
  return obterBanco().transaction(fn);
}
