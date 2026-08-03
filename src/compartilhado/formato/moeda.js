// Dinheiro no sistema inteiro é INTEGER de centavos. Nenhum float encosta em
// valor monetário depois que entra por aqui.

/**
 * Converte entrada do usuário ("12,50", "12.50", 12.5) para centavos.
 * Este é o ÚNICO lugar do projeto onde parseFloat pode ser usado com dinheiro.
 */
export function paraCentavos(entrada) {
  if (entrada === null || entrada === undefined || entrada === '') return null;
  if (typeof entrada === 'number') {
    if (!Number.isFinite(entrada)) return null;
    return Math.round(entrada * 100);
  }
  const limpo = String(entrada).trim().replace(/[R$\s]/gi, '').replace(',', '.');
  if (limpo === '' || !/^-?\d*\.?\d*$/.test(limpo)) return null;
  const n = parseFloat(limpo);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Centavos → "R$ 1.234,56" */
export function formatarBRL(centavos) {
  return 'R$ ' + formatarValor(centavos);
}

/** Centavos → "1.234,56" (sem símbolo, para colunas de cupom e tabelas) */
export function formatarValor(centavos) {
  const n = Number(centavos || 0) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Milésimos → quantidade legível: 1000 → "1", 350 → "0,350" */
export function formatarQtd(milesimal) {
  const n = Number(milesimal || 0);
  if (n % 1000 === 0) return String(n / 1000);
  return (n / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** Quantidade digitada ("1,5" kg, "3") → milésimos */
export function paraMilesimal(entrada) {
  if (entrada === null || entrada === undefined || entrada === '') return null;
  if (typeof entrada === 'number') {
    if (!Number.isFinite(entrada)) return null;
    return Math.round(entrada * 1000);
  }
  const limpo = String(entrada).trim().replace(',', '.');
  if (limpo === '' || !/^\d*\.?\d*$/.test(limpo)) return null;
  const n = parseFloat(limpo);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000);
}
