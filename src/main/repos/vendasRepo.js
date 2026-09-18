import { obterBanco } from '../db/conexao.js';

/** Próximo número de venda. Só pode ser chamado dentro da transação. */
export function proximoNumero() {
  const r = obterBanco()
    .prepare('UPDATE contadores SET valor = valor + 1 WHERE nome = ? RETURNING valor')
    .get('venda');
  return r.valor;
}

export function inserirVenda(v) {
  return obterBanco()
    .prepare(
      `INSERT INTO vendas
         (numero, uuid, sessao_id, cliente_id, status, subtotal_centavos,
          desconto_itens_centavos, desconto_venda_centavos, desconto_venda_tipo,
          desconto_venda_percent, acrescimo_centavos, total_centavos, troco_centavos,
          operador, observacoes, criado_em, data, hora, origem)
       VALUES (@numero, @uuid, @sessao_id, @cliente_id, @status, @subtotal_centavos,
               @desconto_itens_centavos, @desconto_venda_centavos, @desconto_venda_tipo,
               @desconto_venda_percent, @acrescimo_centavos, @total_centavos, @troco_centavos,
               @operador, @observacoes, @criado_em, @data, @hora, @origem)`
    )
    .run(v).lastInsertRowid;
}

export function inserirItem(item) {
  obterBanco()
    .prepare(
      `INSERT INTO venda_itens
         (venda_id, seq, produto_id, codigo_barras, descricao, unidade,
          preco_unit_centavos, qtd_milesimal, desconto_item_centavos,
          rateio_desconto_venda_centavos, total_item_centavos, custo_unit_centavos)
       VALUES (@venda_id, @seq, @produto_id, @codigo_barras, @descricao, @unidade,
               @preco_unit_centavos, @qtd_milesimal, @desconto_item_centavos,
               @rateio_desconto_venda_centavos, @total_item_centavos, @custo_unit_centavos)`
    )
    .run(item);
}

export function inserirPagamento(p) {
  obterBanco()
    .prepare(
      `INSERT INTO pagamentos
         (venda_id, forma, valor_centavos, valor_recebido_centavos, troco_centavos,
          bandeira, parcelas, autorizacao, criado_em)
       VALUES (@venda_id, @forma, @valor_centavos, @valor_recebido_centavos, @troco_centavos,
               @bandeira, @parcelas, @autorizacao, @criado_em)`
    )
    .run(p);
}

export function porId(id) {
  const db = obterBanco();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!venda) return null;
  venda.itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY seq').all(id);
  venda.pagamentos = db.prepare('SELECT * FROM pagamentos WHERE venda_id = ? ORDER BY id').all(id);
  if (venda.cliente_id) {
    venda.cliente = db.prepare('SELECT id, nome, cpf_cnpj, telefone FROM clientes WHERE id = ?').get(venda.cliente_id);
  }
  return venda;
}

export function porNumero(numero) {
  const r = obterBanco().prepare('SELECT id FROM vendas WHERE numero = ?').get(numero);
  return r ? porId(r.id) : null;
}

/** dataFim omitido = mesmo dia de dataInicio (comportamento antigo de "do dia"). */
export function listarDoPeriodo(dataInicio, dataFim = dataInicio) {
  return obterBanco()
    .prepare(
      `SELECT v.id, v.numero, v.data, v.hora, v.status, v.total_centavos, v.operador,
              c.nome AS cliente_nome,
              (SELECT group_concat(DISTINCT forma) FROM pagamentos WHERE venda_id = v.id) AS formas,
              (SELECT count(*) FROM venda_itens WHERE venda_id = v.id) AS qtd_itens
         FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.data BETWEEN ? AND ?
        ORDER BY v.data DESC, v.numero DESC`
    )
    .all(dataInicio, dataFim);
}

export function marcarCancelada({ vendaId, motivo, por, sessaoAtualId, em }) {
  obterBanco()
    .prepare(
      `UPDATE vendas
          SET status = 'cancelada', cancelada_em = ?, cancelada_por = ?,
              cancelada_motivo = ?, cancelada_sessao_id = ?
        WHERE id = ? AND status = 'finalizada'`
    )
    .run(em, por, motivo, sessaoAtualId ?? null, vendaId);
}

// ------------------------------- Rascunho -------------------------------
// Snapshot do carrinho para recuperar a venda após queda de energia.

export function salvarRascunho(json, atualizadoEm) {
  obterBanco()
    .prepare(
      `INSERT INTO rascunho (id, json, atualizado_em) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, atualizado_em = excluded.atualizado_em`
    )
    .run(json, atualizadoEm);
}

export function lerRascunho() {
  return obterBanco().prepare('SELECT json, atualizado_em FROM rascunho WHERE id = 1').get() || null;
}

export function limparRascunho() {
  obterBanco().prepare('DELETE FROM rascunho WHERE id = 1').run();
}
