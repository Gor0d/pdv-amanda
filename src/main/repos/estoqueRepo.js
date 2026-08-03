import { obterBanco } from '../db/conexao.js';
import { agoraTimestamp, hojeISO } from '../../compartilhado/formato/data.js';

/**
 * Lança um movimento no ledger e atualiza o cache em produtos.estoque_milesimal.
 * Deve ser chamado SEMPRE dentro de uma transação de quem o usa — nunca abre
 * transação própria, para não quebrar a atomicidade da venda.
 *
 * @param {number} qtdMilesimal sinalizado: negativo sai, positivo entra
 */
export function lancar(produtoId, tipo, qtdMilesimal, extras = {}) {
  const db = obterBanco();

  const p = db.prepare('SELECT estoque_milesimal, controla_estoque FROM produtos WHERE id = ?').get(produtoId);
  if (!p) throw new Error(`Produto ${produtoId} não existe`);
  if (!p.controla_estoque) return null; // serviços não movimentam estoque

  const saldoApos = p.estoque_milesimal + qtdMilesimal;

  db.prepare(
    `INSERT INTO estoque_movimentos
       (produto_id, tipo, qtd_milesimal, saldo_apos_milesimal, custo_unit_centavos,
        venda_id, motivo, criado_em, criado_por, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    produtoId, tipo, qtdMilesimal, saldoApos,
    extras.custoUnitCentavos ?? null, extras.vendaId ?? null, extras.motivo ?? null,
    agoraTimestamp(), extras.criadoPor ?? null, hojeISO()
  );

  db.prepare('UPDATE produtos SET estoque_milesimal = ? WHERE id = ?').run(saldoApos, produtoId);
  return saldoApos;
}

export function movimentosDe(produtoId, limite = 100) {
  return obterBanco()
    .prepare(
      `SELECT id, tipo, qtd_milesimal, saldo_apos_milesimal, venda_id, motivo, criado_em
         FROM estoque_movimentos WHERE produto_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(produtoId, limite);
}

/**
 * Invariante 1: produtos.estoque_milesimal == SUM(estoque_movimentos).
 * O cache pode divergir por bug; o ledger é a verdade. Esta função reporta e
 * corrige, e é exposta na tela de Diagnóstico.
 */
export function recalcularCache({ corrigir = true } = {}) {
  const db = obterBanco();
  const divergentes = db
    .prepare(
      `SELECT p.id, p.nome, p.estoque_milesimal AS cache,
              coalesce((SELECT SUM(qtd_milesimal) FROM estoque_movimentos m
                         WHERE m.produto_id = p.id), 0) AS ledger
         FROM produtos p
        WHERE p.controla_estoque = 1 AND cache <> ledger`
    )
    .all();

  if (corrigir && divergentes.length) {
    const upd = db.prepare('UPDATE produtos SET estoque_milesimal = ? WHERE id = ?');
    db.transaction(() => {
      for (const d of divergentes) upd.run(d.ledger, d.id);
    })();
  }

  return divergentes;
}

export function abaixoDoMinimo() {
  return obterBanco()
    .prepare(
      `SELECT id, nome, estoque_milesimal, estoque_minimo_milesimal
         FROM produtos
        WHERE ativo = 1 AND controla_estoque = 1
          AND estoque_milesimal <= estoque_minimo_milesimal
        ORDER BY estoque_milesimal`
    )
    .all();
}
