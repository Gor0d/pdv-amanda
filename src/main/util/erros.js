/**
 * Erro de regra de negócio, com código estável para o renderer decidir o que
 * oferecer ao operador (ex.: CAIXA_FECHADO → botão "Abrir caixa").
 *
 * A mensagem é escrita para a dona da loja ler, não para o desenvolvedor:
 * nunca "SQLITE_CONSTRAINT", sempre "Já existe um produto com esse código".
 */
export class ErroNegocio extends Error {
  constructor(codigo, mensagem, detalhes = null) {
    super(mensagem);
    this.name = 'ErroNegocio';
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const CODIGOS = {
  CAIXA_FECHADO: 'CAIXA_FECHADO',
  CARRINHO_VAZIO: 'CARRINHO_VAZIO',
  PAGAMENTO_INCOMPLETO: 'PAGAMENTO_INCOMPLETO',
  ESTOQUE_INSUFICIENTE: 'ESTOQUE_INSUFICIENTE',
  PRODUTO_NAO_ENCONTRADO: 'PRODUTO_NAO_ENCONTRADO',
  CODIGO_DUPLICADO: 'CODIGO_DUPLICADO',
  VENDA_NAO_ENCONTRADA: 'VENDA_NAO_ENCONTRADA',
  VENDA_JA_CANCELADA: 'VENDA_JA_CANCELADA',
  LIMITE_EXCEDIDO: 'LIMITE_EXCEDIDO',
  CONTA_COM_PAGAMENTO: 'CONTA_COM_PAGAMENTO',
  DADOS_INVALIDOS: 'DADOS_INVALIDOS'
};

/**
 * Converte qualquer erro no formato que atravessa o IPC. O renderer recebe
 * sempre {ok:false, codigo, mensagem} e nunca uma stack trace.
 */
export function paraResposta(e, log) {
  if (e instanceof ErroNegocio) {
    return { ok: false, codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes };
  }
  log?.error?.(e);
  return {
    ok: false,
    codigo: 'ERRO_INTERNO',
    mensagem: 'Ocorreu um erro inesperado. Os dados não foram alterados. ' +
              'Se continuar, anote o horário e veja a tela de Diagnóstico.'
  };
}
