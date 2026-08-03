// Normalização e validação de código de barras.
//
// A armadilha real do balcão: o cadastro tem o EAN-13 e o leitor manda o
// UPC-A de 12 dígitos do mesmo produto (ou vice-versa), e o produto "não
// existe". Por isso a busca tenta várias formas do mesmo código antes de
// desistir.

/** Deixa só os dígitos ("789 1000-100103" → "7891000100103") */
export function somenteDigitos(codigo) {
  return String(codigo || '').replace(/\D/g, '');
}

/**
 * Formas alternativas plausíveis do mesmo código, em ordem de probabilidade.
 * Sempre inclui o código original como primeira tentativa.
 */
export function variacoesCodigo(codigo) {
  const original = String(codigo || '').trim();
  const d = somenteDigitos(original);
  const vars = [original];

  const add = (v) => { if (v && !vars.includes(v)) vars.push(v); };

  add(d);
  if (d.length === 12) add('0' + d);            // UPC-A → EAN-13
  if (d.length === 13 && d.startsWith('0')) add(d.slice(1)); // EAN-13 → UPC-A
  if (d.length === 8) add(expandirEan8(d));      // EAN-8 → EAN-13
  if (d.length > 0 && d.length < 13) add(d.padStart(13, '0')); // zeros perdidos
  add(d.replace(/^0+/, ''));                     // zeros à esquerda sobrando

  return vars.filter(Boolean);
}

/** EAN-8 → EAN-13 pelo preenchimento com zeros à esquerda */
export function expandirEan8(ean8) {
  const d = somenteDigitos(ean8);
  if (d.length !== 8) return null;
  return d.padStart(13, '0');
}

/**
 * Dígito verificador mod-10 de EAN-8/EAN-13/UPC-A.
 * @returns {number|null} o DV esperado, ou null se o comprimento não serve
 */
export function digitoVerificador(codigoSemDV) {
  const d = somenteDigitos(codigoSemDV);
  if (![7, 11, 12].includes(d.length)) return null;
  let soma = 0;
  // Da direita para a esquerda, pesos 3 e 1 alternados.
  for (let i = d.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) {
    soma += Number(d[i]) * peso;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Valida o DV. Retorna `true` só quando o código tem comprimento de EAN/UPC e
 * o dígito bate. Códigos internos da loja não são EAN válido — quem chama
 * deve AVISAR, nunca bloquear.
 */
export function ehEanValido(codigo) {
  const d = somenteDigitos(codigo);
  if (![8, 12, 13].includes(d.length)) return false;
  const esperado = digitoVerificador(d.slice(0, -1));
  return esperado !== null && esperado === Number(d[d.length - 1]);
}
