import test from 'node:test';
import assert from 'node:assert/strict';
import { obterBanco } from '../../src/main/db/conexao.js';
import { importar } from '../../src/main/servicos/importacaoServico.js';
import * as produtosRepo from '../../src/main/repos/produtosRepo.js';
import { bancoLimpo, verificarInvariantes, log } from './ajuda.js';

const EXPORT_EXEMPLO = JSON.stringify({
  versao: 1,
  exportadoEm: '2026-08-03T13:00:00.000Z',
  produtos: [
    { code: '7891000100103', name: 'Leite Integral 1L', price: 5.49, stock: 12 },
    { code: '7891234567890', name: 'Café 500g', price: 18.9, stock: 3 },
    { code: '7890000000001', name: 'Sabão em pó', price: 12.5, stock: 0 }
  ],
  vendasLog: [
    { saleId: 'a1', date: '2026-08-01', time: '09:15', code: '7891000100103', name: 'Leite Integral 1L', price: 5.49, qty: 2 },
    { saleId: 'a1', date: '2026-08-01', time: '09:15', code: '7891234567890', name: 'Café 500g', price: 18.9, qty: 1 },
    { saleId: 'b2', date: '2026-08-02', time: '17:40', code: '7891000100103', name: 'Leite Integral 1L', price: 5.49, qty: 1 },
    // Produto que foi excluído do cadastro no protótipo: o histórico apontava
    // para um código que não existe mais.
    { saleId: 'b2', date: '2026-08-02', time: '17:40', code: '7899999999999', name: 'Biscoito (excluído)', price: 4.0, qty: 3 }
  ]
});

test('importa produtos, vendas e mantém as invariantes', () => {
  bancoLimpo();
  const r = importar(EXPORT_EXEMPLO, { arquivo: 'exemplo.json', log });

  assert.equal(r.produtosCriados, 3);
  assert.equal(r.vendasCriadas, 2);
  assert.equal(r.itensSemProduto, 1);
  assert.deepEqual(verificarInvariantes(), []);
});

test('o saldo importado é o saldo final, não é reduzido de novo pelas vendas', () => {
  bancoLimpo();
  importar(EXPORT_EXEMPLO, { log });

  // O protótipo exportou stock=12 já descontadas as 3 unidades vendidas.
  // Recontabilizar as vendas deixaria 9 — e produtos com estoque negativo.
  const leite = produtosRepo.buscarPorCodigo('7891000100103').produto;
  assert.equal(leite.estoque_milesimal, 12000);

  const negativos = obterBanco()
    .prepare('SELECT count(*) c FROM produtos WHERE estoque_milesimal < 0')
    .get().c;
  assert.equal(negativos, 0, 'nenhum produto pode ficar com estoque negativo');
});

test('item de produto excluído vira produto histórico inativo, não órfão', () => {
  bancoLimpo();
  importar(EXPORT_EXEMPLO, { log });

  const db = obterBanco();
  const orfaos = db.prepare('SELECT count(*) c FROM venda_itens WHERE produto_id IS NULL').get().c;
  assert.equal(orfaos, 0);

  const historico = db.prepare("SELECT * FROM produtos WHERE origem = 'historico'").all();
  assert.equal(historico.length, 1);
  assert.equal(historico[0].ativo, 0);
  assert.equal(historico[0].controla_estoque, 0);
});

test('vendas importadas recebem numeração cronológica e pagamento suposto', () => {
  bancoLimpo();
  importar(EXPORT_EXEMPLO, { log });

  const vendas = obterBanco()
    .prepare('SELECT numero, data, hora, total_centavos, origem, sessao_id FROM vendas ORDER BY numero')
    .all();
  assert.equal(vendas[0].data, '2026-08-01');
  assert.equal(vendas[1].data, '2026-08-02');
  assert.equal(vendas[0].total_centavos, 2 * 549 + 1890);
  assert.equal(vendas[0].origem, 'importado');
  assert.equal(vendas[0].sessao_id, null, 'venda importada não pertence a nenhuma sessão de caixa');

  const formas = obterBanco().prepare('SELECT DISTINCT forma FROM pagamentos').all();
  assert.deepEqual(formas, [{ forma: 'dinheiro' }]);
});

test('importar o mesmo arquivo duas vezes não duplica nada', () => {
  bancoLimpo();
  const primeira = importar(EXPORT_EXEMPLO, { log });
  const segunda = importar(EXPORT_EXEMPLO, { log });

  assert.equal(segunda.jaImportado, true);
  assert.equal(segunda.produtosCriados, primeira.produtosCriados);

  const db = obterBanco();
  assert.equal(db.prepare('SELECT count(*) c FROM produtos').get().c, 4); // 3 + 1 histórico
  assert.equal(db.prepare('SELECT count(*) c FROM vendas').get().c, 2);
});

test('arquivo inválido é recusado com mensagem legível', () => {
  bancoLimpo();
  assert.throws(() => importar('isso não é json', { log }), /não é um JSON válido/);
  assert.throws(() => importar('{"foo":1}', { log }), /export do sistema anterior/);
});
