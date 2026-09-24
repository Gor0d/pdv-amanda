-- Validade do produto: um único campo por produto, não por lote. Este
-- sistema não rastreia lotes/remessas separadamente — se um dia isso for
-- necessário (mesma mercadoria com validades diferentes ao mesmo tempo), vai
-- exigir uma tabela própria. Por ora é o suficiente para o alerta de
-- vencimento pedido pela loja.
ALTER TABLE produtos ADD COLUMN validade TEXT;

-- Fornecedor do produto, opcional.
ALTER TABLE produtos ADD COLUMN fornecedor_id INTEGER REFERENCES fornecedores(id);
CREATE INDEX ix_produtos_fornecedor ON produtos(fornecedor_id);
