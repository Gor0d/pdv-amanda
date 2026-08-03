import { ratearDesconto, descontoPercentual } from './ratearDesconto.js';

/**
 * Recalcula todos os totais de uma venda a partir dos itens. É a única
 * implementação de aritmética de venda no projeto: o renderer chama para
 * exibir e o main chama de novo, dentro da transação, para gravar. O total que
 * vem da tela é conferido contra este resultado, nunca confiado.
 *
 * @param {{precoUnitCentavos:number, qtdMilesimal:number, descontoItemCentavos?:number}[]} itens
 * @param {{tipo?:'valor'|'percentual', valorCentavos?:number, percentual?:number}} descontoVenda
 * @param {number} acrescimoCentavos
 */
export function calcularTotais(itens, descontoVenda = {}, acrescimoCentavos = 0) {
  const linhas = itens.map((it) => {
    // Preço × quantidade em milésimos: divide por 1000 e arredonda ao centavo.
    // 0,350 kg × R$ 18,90 = 661,5 centavos → 662.
    const bruto = Math.round((it.precoUnitCentavos * it.qtdMilesimal) / 1000);
    const descItem = Math.min(Math.max(0, Math.trunc(it.descontoItemCentavos || 0)), bruto);
    return { bruto, descontoItemCentavos: descItem, liquido: bruto - descItem };
  });

  const subtotalCentavos = linhas.reduce((s, l) => s + l.bruto, 0);
  const descontoItensCentavos = linhas.reduce((s, l) => s + l.descontoItemCentavos, 0);
  const baseDesconto = subtotalCentavos - descontoItensCentavos;

  let descontoVendaCentavos = 0;
  if (descontoVenda && descontoVenda.tipo === 'percentual') {
    descontoVendaCentavos = descontoPercentual(baseDesconto, Number(descontoVenda.percentual) || 0);
  } else if (descontoVenda && descontoVenda.tipo === 'valor') {
    descontoVendaCentavos = Math.min(baseDesconto, Math.max(0, Math.trunc(descontoVenda.valorCentavos || 0)));
  }

  const rateio = ratearDesconto(linhas.map((l) => l.liquido), descontoVendaCentavos);

  const acrescimo = Math.max(0, Math.trunc(acrescimoCentavos || 0));
  const totalCentavos = baseDesconto - descontoVendaCentavos + acrescimo;

  return {
    subtotalCentavos,
    descontoItensCentavos,
    descontoVendaCentavos,
    acrescimoCentavos: acrescimo,
    totalCentavos,
    itens: linhas.map((l, i) => ({
      brutoCentavos: l.bruto,
      descontoItemCentavos: l.descontoItemCentavos,
      rateioDescontoVendaCentavos: rateio[i],
      totalItemCentavos: l.liquido - rateio[i]
    }))
  };
}

/**
 * Situação do pagamento de uma venda.
 * `valorCentavos` é o que a forma abateu da venda; `recebidoCentavos` só
 * existe em dinheiro e pode ser maior — a diferença é troco.
 */
export function calcularPagamento(totalCentavos, pagamentos) {
  const aplicado = pagamentos.reduce((s, p) => s + Math.trunc(p.valorCentavos || 0), 0);
  const recebidoDinheiro = pagamentos
    .filter((p) => p.forma === 'dinheiro')
    .reduce((s, p) => s + Math.trunc(p.recebidoCentavos ?? p.valorCentavos ?? 0), 0);
  const aplicadoDinheiro = pagamentos
    .filter((p) => p.forma === 'dinheiro')
    .reduce((s, p) => s + Math.trunc(p.valorCentavos || 0), 0);

  return {
    aplicadoCentavos: aplicado,
    faltaCentavos: Math.max(0, totalCentavos - aplicado),
    trocoCentavos: Math.max(0, recebidoDinheiro - aplicadoDinheiro),
    completo: aplicado === totalCentavos
  };
}
