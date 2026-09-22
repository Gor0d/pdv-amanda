-- Cadastro de fornecedor. Ainda não linkado a produtos nem a entradas de
-- estoque (isso é fase futura, quando existir tela de compras de verdade) —
-- por ora é só um cadastro de referência, igual clientes é hoje.

CREATE TABLE fornecedores (
  id          INTEGER PRIMARY KEY,
  nome        TEXT NOT NULL,
  cpf_cnpj    TEXT,
  telefone    TEXT,
  email       TEXT,
  endereco    TEXT,
  observacoes TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_fornecedores_nome ON fornecedores(nome);
