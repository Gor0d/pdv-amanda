import { obterBanco } from '../db/conexao.js';
import { agoraTimestamp } from '../../compartilhado/formato/data.js';

export function abrir({ identificador, operador, observacoes } = {}) {
  const db = obterBanco();
  const ts = agoraTimestamp();
  const info = db
    .prepare(
      `INSERT INTO comandas (identificador, status, aberta_em, aberta_por, observacoes)
       VALUES (?, 'aberta', ?, ?, ?)`
    )
    .run(String(identificador).trim(), ts, operador || null, observacoes || null);
  return info.lastInsertRowid;
}

/** Comandas em aberto, com o total corrente já somado — alimenta os cartões da tela. */
export function listarAbertas() {
  return obterBanco()
    .prepare(
      `SELECT c.id, c.identificador, c.aberta_em, c.aberta_por,
              coalesce((SELECT SUM(i.preco_unit_centavos * i.qtd_milesimal / 1000)
                          FROM comanda_itens i WHERE i.comanda_id = c.id AND i.removido = 0), 0) AS total_centavos,
              coalesce((SELECT count(*) FROM comanda_itens i
                         WHERE i.comanda_id = c.id AND i.removido = 0), 0) AS qtd_itens
         FROM comandas c
        WHERE c.status = 'aberta'
        ORDER BY c.aberta_em`
    )
    .all();
}

export function porId(id) {
  const comanda = obterBanco().prepare('SELECT * FROM comandas WHERE id = ?').get(id);
  if (!comanda) return null;
  comanda.itens = itensDe(id);
  return comanda;
}

export function itensDe(comandaId) {
  return obterBanco()
    .prepare(
      `SELECT id, produto_id, descricao, preco_unit_centavos, qtd_milesimal, criado_em
         FROM comanda_itens
        WHERE comanda_id = ? AND removido = 0
        ORDER BY id`
    )
    .all(comandaId);
}

export function adicionarItem(comandaId, { produtoId, descricao, precoUnitCentavos, qtdMilesimal }) {
  const db = obterBanco();
  const ts = agoraTimestamp();

  // Mesmo produto lançado de novo na mesma comanda: soma na linha existente
  // em vez de espalhar o pedido em várias linhas iguais no extrato.
  const existente = db
    .prepare(
      `SELECT id, qtd_milesimal FROM comanda_itens
        WHERE comanda_id = ? AND produto_id = ? AND preco_unit_centavos = ? AND removido = 0`
    )
    .get(comandaId, produtoId, precoUnitCentavos);

  if (existente) {
    db.prepare('UPDATE comanda_itens SET qtd_milesimal = qtd_milesimal + ? WHERE id = ?')
      .run(qtdMilesimal, existente.id);
    return existente.id;
  }

  const info = db
    .prepare(
      `INSERT INTO comanda_itens
         (comanda_id, produto_id, descricao, preco_unit_centavos, qtd_milesimal, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(comandaId, produtoId, descricao, precoUnitCentavos, qtdMilesimal, ts);
  return info.lastInsertRowid;
}

export function removerItem(itemId) {
  obterBanco().prepare('UPDATE comanda_itens SET removido = 1 WHERE id = ?').run(itemId);
}

export function marcarFechada(comandaId, { vendaId, em }) {
  obterBanco()
    .prepare(`UPDATE comandas SET status = 'fechada', fechada_em = ?, venda_id = ? WHERE id = ?`)
    .run(em, vendaId, comandaId);
}
