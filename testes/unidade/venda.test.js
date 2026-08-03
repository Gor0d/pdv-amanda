import test from 'node:test';
import assert from 'node:assert/strict';
import { obterBanco } from '../../src/main/db/conexao.js';
import * as vendaServico from '../../src/main/servicos/vendaServico.js';
import * as produtosRepo from '../../src/main/repos/produtosRepo.js';
import * as estoqueRepo from '../../src/main/repos/estoqueRepo.js';
import { bancoLimpo, criarProduto, verificarInvariantes, log } from './ajuda.js';

test('migrações levam um banco vazio até a última versão', () => {
  const db = bancoLimpo();
  assert.ok(db.pragma('user_version', { simple: true }) >= 1);
  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((t) => t.name);
  for (const esperada of ['produtos', 'vendas', 'venda_itens', 'pagamentos',
                          'estoque_movimentos', 'caixa_sessoes', 'contas_receber']) {
    assert.ok(tabelas.includes(esperada), `falta a tabela ${esperada}`);
  }
});

test('finalizar grava venda, itens, pagamento e baixa o estoque', () => {
  bancoLimpo();
  const id = criarProduto({ nome: 'Leite', precoCentavos: 549, estoque: 10, codigo: '7891000100103' });

  const r = vendaServico.finalizar({
    itens: [{ produtoId: id, precoUnitCentavos: 549, qtdMilesimal: 2000, codigoBarras: '7891000100103' }],
    pagamentos: [{ forma: 'dinheiro', valorCentavos: 1098, recebidoCentavos: 2000 }]
  }, { log });

  assert.equal(r.numero, 1);
  assert.equal(r.totais.totalCentavos, 1098);
  assert.equal(r.trocoCentavos, 902);
  assert.equal(produtosRepo.porId(id).estoque_milesimal, 8000);
  assert.deepEqual(verificarInvariantes(), []);
});

test('a transação é atômica: falha no meio não deixa rastro', () => {
  bancoLimpo();
  const bom = criarProduto({ nome: 'Bom', precoCentavos: 100, estoque: 5 });
  const db = obterBanco();
  const antes = {
    vendas: db.prepare('SELECT count(*) c FROM vendas').get().c,
    movimentos: db.prepare('SELECT count(*) c FROM estoque_movimentos').get().c,
    contador: db.prepare("SELECT valor FROM contadores WHERE nome='venda'").get().valor,
    estoque: produtosRepo.porId(bom).estoque_milesimal
  };

  // O segundo item aponta para um produto inexistente: a falha acontece depois
  // de o primeiro já ter sido validado.
  assert.throws(() =>
    vendaServico.finalizar({
      itens: [
        { produtoId: bom, precoUnitCentavos: 100, qtdMilesimal: 1000 },
        { produtoId: 99999, precoUnitCentavos: 100, qtdMilesimal: 1000 }
      ],
      pagamentos: [{ forma: 'dinheiro', valorCentavos: 200 }]
    }, { log })
  );

  const depois = {
    vendas: db.prepare('SELECT count(*) c FROM vendas').get().c,
    movimentos: db.prepare('SELECT count(*) c FROM estoque_movimentos').get().c,
    contador: db.prepare("SELECT valor FROM contadores WHERE nome='venda'").get().valor,
    estoque: produtosRepo.porId(bom).estoque_milesimal
  };
  assert.deepEqual(depois, antes, 'nada pode ter sido persistido');
});

test('venda é recusada quando o pagamento não fecha com o total', () => {
  bancoLimpo();
  const id = criarProduto({ precoCentavos: 1000, estoque: 5 });
  assert.throws(
    () => vendaServico.finalizar({
      itens: [{ produtoId: id, precoUnitCentavos: 1000, qtdMilesimal: 1000 }],
      pagamentos: [{ forma: 'pix', valorCentavos: 900 }]
    }, { log }),
    /PAGAMENTO_INCOMPLETO|não cobrem/
  );
});

test('venda é recusada por estoque insuficiente', () => {
  bancoLimpo();
  const id = criarProduto({ nome: 'Pouco', precoCentavos: 100, estoque: 1 });
  assert.throws(
    () => vendaServico.finalizar({
      itens: [{ produtoId: id, precoUnitCentavos: 100, qtdMilesimal: 5000 }],
      pagamentos: [{ forma: 'dinheiro', valorCentavos: 500 }]
    }, { log }),
    /estoque suficiente/
  );
});

test('venda com desconto mantém as invariantes de total', () => {
  bancoLimpo();
  const a = criarProduto({ nome: 'A', precoCentavos: 333, estoque: 10 });
  const b = criarProduto({ nome: 'B', precoCentavos: 333, estoque: 10 });
  const c = criarProduto({ nome: 'C', precoCentavos: 334, estoque: 10 });

  const r = vendaServico.finalizar({
    itens: [a, b, c].map((id) => ({ produtoId: id, qtdMilesimal: 1000 })),
    descontoVenda: { tipo: 'valor', valorCentavos: 100 },
    pagamentos: [{ forma: 'dinheiro', valorCentavos: 900 }]
  }, { log });

  assert.equal(r.totais.totalCentavos, 900);
  assert.deepEqual(verificarInvariantes(), []);
});

test('cancelar devolve o estoque e preserva a venda', () => {
  bancoLimpo();
  const id = criarProduto({ nome: 'Café', precoCentavos: 1500, estoque: 10 });
  const venda = vendaServico.finalizar({
    itens: [{ produtoId: id, qtdMilesimal: 3000 }],
    pagamentos: [{ forma: 'pix', valorCentavos: 4500 }]
  }, { log });
  assert.equal(produtosRepo.porId(id).estoque_milesimal, 7000);

  vendaServico.cancelar({ vendaId: venda.vendaId, motivo: 'Cliente desistiu', por: 'Amanda' }, { log });

  assert.equal(produtosRepo.porId(id).estoque_milesimal, 10000, 'estoque revertido');
  const db = obterBanco();
  const v = db.prepare('SELECT status, cancelada_motivo FROM vendas WHERE id = ?').get(venda.vendaId);
  assert.equal(v.status, 'cancelada');
  assert.equal(v.cancelada_motivo, 'Cliente desistiu');
  // A venda continua existindo, com seus itens — nada é apagado.
  assert.equal(db.prepare('SELECT count(*) c FROM venda_itens WHERE venda_id = ?').get(venda.vendaId).c, 1);
  assert.deepEqual(verificarInvariantes(), []);
});

test('cancelar duas vezes é recusado e exige motivo', () => {
  bancoLimpo();
  const id = criarProduto({ precoCentavos: 100, estoque: 5 });
  const venda = vendaServico.finalizar({
    itens: [{ produtoId: id, qtdMilesimal: 1000 }],
    pagamentos: [{ forma: 'dinheiro', valorCentavos: 100 }]
  }, { log });

  assert.throws(() => vendaServico.cancelar({ vendaId: venda.vendaId, motivo: '  ' }, { log }), /motivo/);
  vendaServico.cancelar({ vendaId: venda.vendaId, motivo: 'Erro de digitação' }, { log });
  assert.throws(() => vendaServico.cancelar({ vendaId: venda.vendaId, motivo: 'de novo' }, { log }), /já está cancelada/);
});

test('busca por código encontra apesar da diferença UPC-A / EAN-13', () => {
  bancoLimpo();
  // Cadastrado com 13 dígitos; o leitor manda os 12 do UPC-A.
  const id = criarProduto({ nome: 'Importado', precoCentavos: 500, codigo: '0012345678905' });
  const r = produtosRepo.buscarPorCodigo('012345678905');
  assert.ok(r, 'deveria encontrar pela variação UPC-A');
  assert.equal(r.produto.id, id);
});

test('recalcularCache conserta divergência entre cache e ledger', () => {
  bancoLimpo();
  const id = criarProduto({ nome: 'X', precoCentavos: 100, estoque: 10 });
  // Simula corrupção do cache.
  obterBanco().prepare('UPDATE produtos SET estoque_milesimal = 999 WHERE id = ?').run(id);
  assert.equal(verificarInvariantes().length, 1);

  const divergentes = estoqueRepo.recalcularCache();
  assert.equal(divergentes.length, 1);
  assert.equal(produtosRepo.porId(id).estoque_milesimal, 10000);
  assert.deepEqual(verificarInvariantes(), []);
});

test('produto com controla_estoque=0 não movimenta ledger', () => {
  bancoLimpo();
  const id = produtosRepo.criar({ nome: 'Serviço', precoCentavos: 5000, controlaEstoque: false });
  vendaServico.finalizar({
    itens: [{ produtoId: id, qtdMilesimal: 1000 }],
    pagamentos: [{ forma: 'credito', valorCentavos: 5000 }]
  }, { log });
  assert.equal(obterBanco().prepare('SELECT count(*) c FROM estoque_movimentos').get().c, 0);
  assert.deepEqual(verificarInvariantes(), []);
});
