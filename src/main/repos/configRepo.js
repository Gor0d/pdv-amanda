import { obterBanco } from '../db/conexao.js';

export function obterTudo() {
  const linhas = obterBanco().prepare('SELECT chave, valor FROM config').all();
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

export function obter(chave, padrao = null) {
  const l = obterBanco().prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return l ? l.valor : padrao;
}

export function obterNumero(chave, padrao = 0) {
  const v = Number(obter(chave));
  return Number.isFinite(v) ? v : padrao;
}

export function obterBooleano(chave, padrao = false) {
  const v = obter(chave);
  return v === null ? padrao : v === '1' || v === 'true';
}

export function definir(chave, valor) {
  obterBanco()
    .prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, String(valor));
}

export function definirVarios(objeto) {
  const db = obterBanco();
  const stmt = db.prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(objeto)) stmt.run(k, String(v));
  })();
}
