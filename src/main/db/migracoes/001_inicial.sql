-- Esquema inicial do PDV.
--
-- Convenções obrigatórias em todo o arquivo:
--   dinheiro     -> *_centavos INTEGER          (nenhum float toca dinheiro)
--   quantidade   -> *_milesimal INTEGER (x1000) (suporta 0,350 kg)
--   data         -> TEXT "AAAA-MM-DD"
--   carimbo      -> TEXT "AAAA-MM-DD HH:MM:SS" no fuso local
--   booleano     -> INTEGER 0/1
--
-- Todas as tabelas são criadas já aqui, inclusive as que só entram em uso nas
-- fases 4 e 5 (caixa e fiado). Criar depois exigiria migrar dados de produção.

-- ============================ CONFIGURAÇÃO ============================

CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO config (chave, valor) VALUES
  ('loja_nome',                 'Minha Loja'),
  ('loja_cnpj',                 ''),
  ('loja_endereco',             ''),
  ('loja_telefone',             ''),
  ('cupom_rodape',              'Obrigado pela preferência!'),
  ('impressao_modo',            'nenhum'),   -- nenhum | driver | escpos
  ('impressao_transporte',      'tcp'),      -- tcp | unc | arquivo
  ('impressao_destino',         ''),         -- "127.0.0.1:9100" ou "\\localhost\POS80"
  ('impressao_largura',         '80'),       -- 58 | 80
  ('impressao_automatica',      '1'),
  ('estoque_negativo_permitido','0'),
  ('estoque_minimo_alerta',     '5'),
  ('caixa_tolerancia_centavos', '0'),
  ('fiado_prazo_padrao_dias',   '30'),
  ('operador_padrao',           'Operador'),
  ('balanca_habilitada',        '0'),
  ('balanca_prefixo',           '2');

-- Numeração sequencial de venda. Incrementado DENTRO da transação de
-- finalização, para nunca haver buraco nem número repetido.
CREATE TABLE contadores (
  nome  TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
INSERT INTO contadores (nome, valor) VALUES ('venda', 0);

-- ============================== PRODUTOS ==============================

CREATE TABLE produtos (
  id                       INTEGER PRIMARY KEY,   -- chave estável, NUNCA muda
  sku                      TEXT,                  -- código interno opcional
  nome                     TEXT NOT NULL,
  descricao                TEXT,
  unidade                  TEXT NOT NULL DEFAULT 'UN',
  preco_centavos           INTEGER NOT NULL CHECK (preco_centavos >= 0),
  custo_centavos           INTEGER,
  -- Cache do ledger em estoque_movimentos. Reconstruível a qualquer momento
  -- por estoque.recalcularCache(); o ledger é que é a verdade.
  estoque_milesimal        INTEGER NOT NULL DEFAULT 0,
  estoque_minimo_milesimal INTEGER NOT NULL DEFAULT 5000,
  controla_estoque         INTEGER NOT NULL DEFAULT 1,  -- 0 para serviços
  ativo                    INTEGER NOT NULL DEFAULT 1,
  origem                   TEXT NOT NULL DEFAULT 'manual', -- manual|importado|historico
  -- Reservado para NFC-e. Todos anuláveis e sem uso na v1; existem para que a
  -- emissão fiscal futura não exija migrar a tabela de produtos em produção.
  ncm TEXT, cest TEXT, cfop TEXT, cst_icms TEXT, csosn TEXT,
  origem_mercadoria TEXT, aliquota_icms REAL, cst_pis TEXT, cst_cofins TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_produtos_nome ON produtos(nome);
CREATE UNIQUE INDEX ux_produtos_sku ON produtos(sku) WHERE sku IS NOT NULL AND sku <> '';

-- Códigos de barras N:1. Existir separado de `produtos` é o que permite trocar
-- o código de um produto sem órfanar o histórico, e cadastrar o código da
-- caixa fechada além do da unidade.
CREATE TABLE produto_codigos (
  id              INTEGER PRIMARY KEY,
  produto_id      INTEGER NOT NULL REFERENCES produtos(id),
  codigo          TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'EAN',   -- EAN|INTERNO|BALANCA_PLU|DUN
  fator_milesimal INTEGER NOT NULL DEFAULT 1000, -- caixa com 12 un = 12000
  principal       INTEGER NOT NULL DEFAULT 0,
  criado_em       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_produto_codigos ON produto_codigos(codigo);
CREATE INDEX ix_produto_codigos_produto ON produto_codigos(produto_id);

-- =========================== CLIENTES / FIADO ==========================

CREATE TABLE clientes (
  id       INTEGER PRIMARY KEY,
  nome     TEXT NOT NULL,
  cpf_cnpj TEXT,
  telefone TEXT,
  email    TEXT,
  endereco TEXT, cidade TEXT, uf TEXT, cep TEXT,
  limite_credito_centavos INTEGER NOT NULL DEFAULT 0, -- 0 = sem limite definido
  observacoes TEXT,
  ativo    INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX ix_clientes_nome ON clientes(nome);
CREATE UNIQUE INDEX ux_clientes_doc ON clientes(cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL AND cpf_cnpj <> '';

-- ================================ CAIXA ================================

CREATE TABLE caixa_sessoes (
  id        INTEGER PRIMARY KEY,
  status    TEXT NOT NULL CHECK (status IN ('aberta','fechada')),
  data      TEXT NOT NULL,
  aberta_em TEXT NOT NULL,
  aberta_por TEXT NOT NULL,
  fundo_troco_centavos INTEGER NOT NULL DEFAULT 0,
  fechada_em TEXT, fechada_por TEXT,
  esperado_json TEXT,   -- {"dinheiro":12345,...} congelado no fechamento
  contado_json  TEXT,
  diferenca_centavos INTEGER,
  observacoes TEXT
);
-- Invariante estrutural: no máximo uma sessão aberta em todo o banco.
CREATE UNIQUE INDEX ux_caixa_uma_aberta ON caixa_sessoes(status) WHERE status = 'aberta';

CREATE TABLE caixa_movimentos (
  id        INTEGER PRIMARY KEY,
  sessao_id INTEGER NOT NULL REFERENCES caixa_sessoes(id),
  tipo      TEXT NOT NULL CHECK (tipo IN
              ('abertura','venda','sangria','suprimento','recebimento_fiado','estorno_venda')),
  forma_pagamento TEXT,          -- dinheiro|pix|debito|credito
  valor_centavos  INTEGER NOT NULL,  -- SINALIZADO: + entra, - sai
  venda_id         INTEGER REFERENCES vendas(id),
  conta_receber_id INTEGER REFERENCES contas_receber(id),
  descricao TEXT,
  criado_em TEXT NOT NULL,
  criado_por TEXT
);
CREATE INDEX ix_caixa_mov_sessao ON caixa_movimentos(sessao_id);

-- ================================ VENDAS ===============================

CREATE TABLE vendas (
  id     INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  uuid   TEXT NOT NULL UNIQUE,
  sessao_id  INTEGER REFERENCES caixa_sessoes(id), -- NULL só em venda importada
  cliente_id INTEGER REFERENCES clientes(id),
  status TEXT NOT NULL CHECK (status IN ('finalizada','cancelada')),
  subtotal_centavos       INTEGER NOT NULL,
  desconto_itens_centavos INTEGER NOT NULL DEFAULT 0,
  desconto_venda_centavos INTEGER NOT NULL DEFAULT 0,
  desconto_venda_tipo     TEXT,  -- valor | percentual
  desconto_venda_percent  REAL,
  acrescimo_centavos      INTEGER NOT NULL DEFAULT 0,
  total_centavos          INTEGER NOT NULL,
  troco_centavos          INTEGER NOT NULL DEFAULT 0,
  operador TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  cancelada_em TEXT, cancelada_por TEXT, cancelada_motivo TEXT,
  -- Estorno de venda cuja sessão já foi fechada: os movimentos de caixa
  -- negativos entram na sessão ATUAL, preservando o fechamento já conferido.
  cancelada_sessao_id INTEGER REFERENCES caixa_sessoes(id),
  origem TEXT NOT NULL DEFAULT 'pdv',   -- pdv | importado
  -- Reservado para NFC-e (ver comentário em produtos).
  nfce_status TEXT, nfce_serie INTEGER, nfce_numero INTEGER,
  nfce_chave TEXT, nfce_protocolo TEXT, nfce_xml_caminho TEXT, nfce_qrcode TEXT
);
CREATE INDEX ix_vendas_data    ON vendas(data);
CREATE INDEX ix_vendas_sessao  ON vendas(sessao_id);
CREATE INDEX ix_vendas_cliente ON vendas(cliente_id);

CREATE TABLE venda_itens (
  id       INTEGER PRIMARY KEY,
  venda_id INTEGER NOT NULL REFERENCES vendas(id),
  seq      INTEGER NOT NULL,
  produto_id INTEGER REFERENCES produtos(id),
  -- SNAPSHOT: renomear ou reprecificar um produto não pode alterar o cupom de
  -- uma venda de dois anos atrás.
  codigo_barras TEXT,
  descricao     TEXT NOT NULL,
  unidade       TEXT NOT NULL,
  preco_unit_centavos INTEGER NOT NULL,
  qtd_milesimal       INTEGER NOT NULL,
  desconto_item_centavos         INTEGER NOT NULL DEFAULT 0,
  rateio_desconto_venda_centavos INTEGER NOT NULL DEFAULT 0,
  total_item_centavos            INTEGER NOT NULL,
  custo_unit_centavos INTEGER,
  ncm TEXT, cfop TEXT, cst_icms TEXT
);
CREATE INDEX ix_itens_venda   ON venda_itens(venda_id);
CREATE INDEX ix_itens_produto ON venda_itens(produto_id);

CREATE TABLE pagamentos (
  id       INTEGER PRIMARY KEY,
  venda_id INTEGER NOT NULL REFERENCES vendas(id),
  forma    TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','debito','credito','fiado')),
  -- valor_centavos é o que abateu da venda; valor_recebido_centavos só existe
  -- em dinheiro e pode ser maior. Manter separado é o que faz o esperado do
  -- fechamento de caixa sair certo sem precisar subtrair troco depois.
  valor_centavos          INTEGER NOT NULL,
  valor_recebido_centavos INTEGER,
  troco_centavos          INTEGER NOT NULL DEFAULT 0,
  bandeira TEXT, parcelas INTEGER DEFAULT 1, autorizacao TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_pag_venda ON pagamentos(venda_id);

-- ================================ FIADO ================================

CREATE TABLE contas_receber (
  id         INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  venda_id   INTEGER REFERENCES vendas(id),
  valor_centavos      INTEGER NOT NULL,
  valor_pago_centavos INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL CHECK (status IN ('aberta','parcial','paga','cancelada')),
  vencimento TEXT,
  descricao  TEXT,
  criado_em  TEXT NOT NULL,
  quitado_em TEXT
);
CREATE INDEX ix_cr_cliente ON contas_receber(cliente_id, status);

CREATE TABLE contas_receber_pagamentos (
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER NOT NULL REFERENCES contas_receber(id),
  sessao_id INTEGER REFERENCES caixa_sessoes(id),
  forma     TEXT NOT NULL,
  valor_centavos          INTEGER NOT NULL,
  valor_recebido_centavos INTEGER,
  troco_centavos          INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL,
  criado_por TEXT,
  observacoes TEXT
);
CREATE INDEX ix_crp_conta ON contas_receber_pagamentos(conta_id);

-- ========================= LEDGER DE ESTOQUE ===========================
-- Append-only. Nada aqui é atualizado nem apagado: corrigir estoque é lançar
-- um movimento novo. produtos.estoque_milesimal é só um cache disto.

CREATE TABLE estoque_movimentos (
  id         INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  tipo       TEXT NOT NULL CHECK (tipo IN
               ('venda','estorno_venda','entrada','ajuste','inventario','perda','importacao')),
  qtd_milesimal        INTEGER NOT NULL,  -- SINALIZADO
  saldo_apos_milesimal INTEGER NOT NULL,  -- auditoria: saldo logo após o lançamento
  custo_unit_centavos  INTEGER,
  venda_id   INTEGER REFERENCES vendas(id),
  motivo     TEXT,
  criado_em  TEXT NOT NULL,
  criado_por TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX ix_estq_prod ON estoque_movimentos(produto_id, id);
CREATE INDEX ix_estq_data ON estoque_movimentos(data);

-- ============================== IMPRESSÃO ==============================

CREATE TABLE impressoes (
  id   INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,   -- cupom | fechamento_caixa | recibo_fiado | cancelamento
  venda_id  INTEGER, sessao_id INTEGER, conta_id INTEGER,
  via TEXT, reimpressao INTEGER NOT NULL DEFAULT 0,
  caminho_usado TEXT,   -- escpos-tcp | escpos-unc | driver | pdf
  status TEXT NOT NULL, -- ok | falha | pendente
  erro TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX ix_impressoes_venda ON impressoes(venda_id);

-- Snapshot do carrinho em andamento, para recuperar a venda depois de uma
-- queda de energia. Linha única.
CREATE TABLE rascunho (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Arquivos de importação já consumidos, por hash — torna a importação
-- idempotente se clicarem duas vezes.
CREATE TABLE importacoes (
  id        INTEGER PRIMARY KEY,
  hash      TEXT NOT NULL UNIQUE,
  arquivo   TEXT,
  relatorio_json TEXT,
  criado_em TEXT NOT NULL
);
