import test from 'node:test';
import assert from 'node:assert/strict';
import { ratearDesconto, descontoPercentual } from '../../src/compartilhado/calculos/ratearDesconto.js';
import { calcularTotais, calcularPagamento } from '../../src/compartilhado/calculos/totais.js';
import { paraCentavos, formatarBRL, formatarQtd, paraMilesimal } from '../../src/compartilhado/formato/moeda.js';
import { variacoesCodigo, ehEanValido } from '../../src/compartilhado/calculos/ean.js';
import { formatarDataBR, somarDiasISO, hojeISO } from '../../src/compartilhado/formato/data.js';

test('rateio de desconto soma exatamente o valor pedido', () => {
  // O caso clássico: 100 centavos sobre 3,33/3,33/3,34 não divide exato.
  const r = ratearDesconto([333, 333, 334], 100);
  assert.equal(r.reduce((s, v) => s + v, 0), 100);

  // Uma bateria de casos onde o arredondamento independente erraria.
  const casos = [
    [[100, 100, 100], 1],
    [[1, 1, 1, 1, 1, 1, 1], 3],
    [[999, 1], 500],
    [[1234, 5678, 9012], 777],
    [[50], 50],
    [[100, 200, 300, 400], 251]
  ];
  for (const [bases, desconto] of casos) {
    const p = ratearDesconto(bases, desconto);
    assert.equal(p.reduce((s, v) => s + v, 0), desconto, `bases=${bases} desconto=${desconto}`);
    p.forEach((v, i) => assert.ok(v >= 0 && v <= bases[i], 'parcela dentro da base'));
  }
});

test('rateio nunca desconta mais que o total das bases', () => {
  const r = ratearDesconto([100, 100], 5000);
  assert.equal(r.reduce((s, v) => s + v, 0), 200);
});

test('rateio de lista vazia ou desconto zero', () => {
  assert.deepEqual(ratearDesconto([], 100), []);
  assert.deepEqual(ratearDesconto([100, 200], 0), [0, 0]);
});

test('desconto percentual arredonda ao centavo e respeita o teto', () => {
  assert.equal(descontoPercentual(1000, 5), 50);
  assert.equal(descontoPercentual(333, 10), 33);   // 33,3 -> 33
  assert.equal(descontoPercentual(335, 10), 34);   // 33,5 -> 34
  assert.equal(descontoPercentual(1000, 150), 1000);
  assert.equal(descontoPercentual(1000, -5), 0);
});

test('total de venda com quantidade fracionada e desconto', () => {
  const itens = [
    { precoUnitCentavos: 549, qtdMilesimal: 2000 },            // 2 x 5,49 = 10,98
    { precoUnitCentavos: 1890, qtdMilesimal: 350, descontoItemCentavos: 100 } // 0,350kg x 18,90 = 6,62 -1,00
  ];
  const t = calcularTotais(itens, { tipo: 'percentual', percentual: 5 });

  assert.equal(t.subtotalCentavos, 1098 + 662);
  assert.equal(t.descontoItensCentavos, 100);
  assert.equal(t.descontoVendaCentavos, descontoPercentual(1660, 5)); // 83
  assert.equal(t.totalCentavos, 1660 - 83);

  // Invariante 2: a soma dos itens tem que reproduzir o total.
  const somaItens = t.itens.reduce((s, i) => s + i.totalItemCentavos, 0);
  assert.equal(somaItens + t.acrescimoCentavos, t.totalCentavos);
});

test('troco vem do recebido, não do valor aplicado', () => {
  const s = calcularPagamento(1672, [
    { forma: 'dinheiro', valorCentavos: 1000, recebidoCentavos: 2000 },
    { forma: 'pix', valorCentavos: 672 }
  ]);
  assert.equal(s.completo, true);
  assert.equal(s.faltaCentavos, 0);
  assert.equal(s.trocoCentavos, 1000);
});

test('pagamento incompleto reporta o que falta', () => {
  const s = calcularPagamento(1000, [{ forma: 'pix', valorCentavos: 400 }]);
  assert.equal(s.completo, false);
  assert.equal(s.faltaCentavos, 600);
});

test('conversão de dinheiro aceita as formas que o operador digita', () => {
  assert.equal(paraCentavos('12,50'), 1250);
  assert.equal(paraCentavos('12.50'), 1250);
  assert.equal(paraCentavos('R$ 12,50'), 1250);
  assert.equal(paraCentavos(12.5), 1250);
  assert.equal(paraCentavos('0,01'), 1);
  assert.equal(paraCentavos(''), null);
  assert.equal(paraCentavos('abc'), null);
  // O erro clássico de float: 19.99*100 = 1998.9999...
  assert.equal(paraCentavos(19.99), 1999);
  assert.equal(paraCentavos(0.29), 29);
});

test('formatação em pt-BR', () => {
  assert.equal(formatarBRL(123456), 'R$ 1.234,56');
  assert.equal(formatarBRL(0), 'R$ 0,00');
  assert.equal(formatarQtd(1000), '1');
  assert.equal(formatarQtd(350), '0,350');
  assert.equal(paraMilesimal('1,5'), 1500);
  assert.equal(formatarDataBR('2026-08-03'), '03/08/2026');
});

test('data ISO não escorrega de dia ao somar', () => {
  assert.equal(somarDiasISO('2026-08-03', 30), '2026-09-02');
  assert.equal(somarDiasISO('2026-12-31', 1), '2027-01-01');
  // hojeISO usa o fuso local, então o dia bate com o calendário do caixa.
  assert.match(hojeISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('variações de código cobrem UPC-A e zeros à esquerda', () => {
  assert.ok(variacoesCodigo('012345678905').includes('0012345678905'));
  assert.ok(variacoesCodigo('7891000100103').includes('7891000100103'));
  assert.ok(variacoesCodigo('0123').includes('123'));
});

test('dígito verificador de EAN valida sem bloquear código interno', () => {
  assert.equal(ehEanValido('7891000100103'), true);
  assert.equal(ehEanValido('7891000100104'), false);
  assert.equal(ehEanValido('CAFE01'), false); // código interno: quem chama só avisa
});
