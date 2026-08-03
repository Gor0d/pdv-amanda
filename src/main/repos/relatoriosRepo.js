import { obterBanco } from '../db/conexao.js';

// Toda agregação é GROUP BY no SQLite. O protótipo fazia reduce sobre um array
// de todas as vendas já feitas; com dois anos de histórico isso trava a UI a
// cada troca de data.

export function resumoDoDia(data) {
  return obterBanco()
    .prepare(
      `SELECT coalesce(SUM(total_centavos), 0) AS total_centavos,
              count(*)                         AS qtd_vendas,
              coalesce((SELECT SUM(i.qtd_milesimal)
                          FROM venda_itens i JOIN vendas v2 ON v2.id = i.venda_id
                         WHERE v2.data = ? AND v2.status = 'finalizada'), 0) AS itens_milesimal,
              coalesce((SELECT SUM(total_centavos) FROM vendas
                         WHERE data = ? AND status = 'cancelada'), 0) AS cancelado_centavos,
              coalesce((SELECT count(*) FROM vendas
                         WHERE data = ? AND status = 'cancelada'), 0) AS qtd_canceladas
         FROM vendas
        WHERE data = ? AND status = 'finalizada'`
    )
    .get(data, data, data, data);
}

export function produtosDoDia(data) {
  return obterBanco()
    .prepare(
      `SELECT i.descricao, i.codigo_barras,
              SUM(i.qtd_milesimal)        AS qtd_milesimal,
              SUM(i.total_item_centavos)  AS total_centavos
         FROM venda_itens i JOIN vendas v ON v.id = i.venda_id
        WHERE v.data = ? AND v.status = 'finalizada'
        GROUP BY coalesce(i.produto_id, i.descricao), i.descricao, i.codigo_barras
        ORDER BY total_centavos DESC`
    )
    .all(data);
}

export function porFormaPagamento(data) {
  return obterBanco()
    .prepare(
      `SELECT p.forma, SUM(p.valor_centavos) AS total_centavos, count(*) AS qtd
         FROM pagamentos p JOIN vendas v ON v.id = p.venda_id
        WHERE v.data = ? AND v.status = 'finalizada'
        GROUP BY p.forma
        ORDER BY total_centavos DESC`
    )
    .all(data);
}

/** Últimos dias que tiveram venda — alimenta os chips de atalho do relatório. */
export function diasComVenda(limite = 10) {
  return obterBanco()
    .prepare(
      `SELECT data, SUM(total_centavos) AS total_centavos
         FROM vendas WHERE status = 'finalizada'
        GROUP BY data ORDER BY data DESC LIMIT ?`
    )
    .all(limite);
}

export function estoqueAtual() {
  return obterBanco()
    .prepare(
      `SELECT p.id, p.nome, p.unidade, p.estoque_milesimal, p.estoque_minimo_milesimal,
              (SELECT codigo FROM produto_codigos WHERE produto_id = p.id
                ORDER BY principal DESC, id LIMIT 1) AS codigo
         FROM produtos p
        WHERE p.ativo = 1 AND p.controla_estoque = 1
        ORDER BY p.estoque_milesimal, p.nome`
    )
    .all();
}
