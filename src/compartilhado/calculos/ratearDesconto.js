// Rateio de um desconto de venda entre os itens, em centavos.
//
// O problema: um desconto de R$ 1,00 sobre itens de 3,33 / 3,33 / 3,34 não
// divide em partes exatas. Arredondar cada parte independentemente produz
// soma 99 ou 101 centavos, e aí o total gravado não bate com a soma dos itens
// (invariante 2 quebrada). O método do maior resto ("largest remainder")
// distribui os centavos que sobram para os itens de maior resto fracionário,
// garantindo que a soma seja exatamente o desconto pedido.

/**
 * @param {number[]} bases  valores dos itens em centavos (todos >= 0)
 * @param {number} desconto total a ratear, em centavos (>= 0)
 * @returns {number[]} parcelas em centavos; soma === desconto (limitado à soma das bases)
 */
export function ratearDesconto(bases, desconto) {
  const n = bases.length;
  if (n === 0) return [];

  const total = bases.reduce((s, v) => s + v, 0);
  const alvo = Math.min(Math.max(0, Math.trunc(desconto)), total);
  if (alvo === 0 || total === 0) return new Array(n).fill(0);

  // Piso proporcional + resto fracionário de cada item.
  const partes = new Array(n);
  const restos = new Array(n);
  let distribuido = 0;
  for (let i = 0; i < n; i++) {
    const exato = (bases[i] * alvo) / total;
    partes[i] = Math.floor(exato);
    restos[i] = exato - partes[i];
    distribuido += partes[i];
  }

  // Sobra vai para os maiores restos; empate desempata pelo item de maior base,
  // depois pelo índice — determinístico, para o teste golden não oscilar.
  let sobra = alvo - distribuido;
  const ordem = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    if (restos[b] !== restos[a]) return restos[b] - restos[a];
    if (bases[b] !== bases[a]) return bases[b] - bases[a];
    return a - b;
  });
  for (let k = 0; sobra > 0 && k < ordem.length; k++) {
    // Nunca descontar mais que o próprio item vale.
    if (partes[ordem[k]] < bases[ordem[k]]) {
      partes[ordem[k]]++;
      sobra--;
    }
  }

  return partes;
}

/**
 * Desconto percentual sobre um valor, em centavos.
 * Arredonda ao centavo mais próximo e nunca ultrapassa a base.
 */
export function descontoPercentual(baseCentavos, percentual) {
  if (!Number.isFinite(percentual) || percentual <= 0) return 0;
  const p = Math.min(percentual, 100);
  return Math.min(baseCentavos, Math.round((baseCentavos * p) / 100));
}
