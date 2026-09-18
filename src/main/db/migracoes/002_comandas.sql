-- Comandas: aba aberta por mesa/cliente no bar, para lançar bebidas e itens
-- aos poucos e cobrar tudo de uma vez só quando pedirem a conta.
--
-- Decisão: comanda NÃO baixa estoque nem gera venda enquanto está aberta.
-- O estoque só é baixado quando a comanda fecha e vira uma venda de verdade
-- (mesma vendas/venda_itens/estoque_movimentos de sempre) — reaproveita o
-- fluxo de finalização já testado, em vez de duplicar a lógica de baixa de
-- estoque para um segundo caminho. Isso significa que o saldo de estoque só
-- reflete o consumo da comanda no momento em que ela é fechada, não a cada
-- item lançado. Para uma loja/bar pequeno isso é aceitável; se um dia for
-- preciso ver o estoque cair item a item, dá para lançar no ledger na hora
-- do lançamento — mas isso é problema pra depois, não pra agora.

CREATE TABLE comandas (
  id           INTEGER PRIMARY KEY,
  identificador TEXT NOT NULL,   -- "Mesa 4", "João", o que a atendente digitar
  status       TEXT NOT NULL CHECK (status IN ('aberta','fechada')),
  aberta_em    TEXT NOT NULL,
  aberta_por   TEXT,
  fechada_em   TEXT,
  -- Setado quando a comanda fecha e vira uma venda de verdade.
  venda_id     INTEGER REFERENCES vendas(id),
  observacoes  TEXT
);
CREATE INDEX ix_comandas_status ON comandas(status);

-- Itens lançados na comanda enquanto ela está aberta. SNAPSHOT do preço no
-- momento do lançamento, pelo mesmo motivo de venda_itens: mudar o preço no
-- cadastro no meio da noite não pode alterar o que já foi consumido.
CREATE TABLE comanda_itens (
  id                  INTEGER PRIMARY KEY,
  comanda_id          INTEGER NOT NULL REFERENCES comandas(id),
  produto_id          INTEGER REFERENCES produtos(id),
  descricao           TEXT NOT NULL,
  preco_unit_centavos INTEGER NOT NULL,
  qtd_milesimal       INTEGER NOT NULL,
  criado_em           TEXT NOT NULL,
  -- Removido em vez de DELETE: mantém rastro de um lançamento errado.
  removido            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_comanda_itens_comanda ON comanda_itens(comanda_id);
