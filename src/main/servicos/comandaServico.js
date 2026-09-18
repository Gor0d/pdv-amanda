import { obterBanco } from '../db/conexao.js';
import * as comandasRepo from '../repos/comandasRepo.js';
import * as vendaServico from './vendaServico.js';
import { agoraTimestamp } from '../../compartilhado/formato/data.js';
import { ErroNegocio, CODIGOS } from '../util/erros.js';

/**
 * Fecha a comanda e cobra tudo de uma vez: transforma os itens lançados em
 * uma venda de verdade (reaproveitando vendaServico.finalizar, que já cuida
 * de baixar estoque, checar pagamento e gravar tudo numa transação) e marca a
 * comanda como fechada apontando pra essa venda.
 */
export function fechar(comandaId, { pagamentos, operador, observacoes } = {}, { log = console } = {}) {
  const db = obterBanco();

  return db.transaction(() => {
    const comanda = comandasRepo.porId(comandaId);
    if (!comanda) {
      throw new ErroNegocio(CODIGOS.COMANDA_NAO_ENCONTRADA, 'Comanda não encontrada.');
    }
    if (comanda.status === 'fechada') {
      throw new ErroNegocio(CODIGOS.COMANDA_JA_FECHADA, 'Essa comanda já foi fechada.');
    }
    if (!comanda.itens.length) {
      throw new ErroNegocio(CODIGOS.CARRINHO_VAZIO, 'A comanda não tem nenhum item lançado.');
    }

    const resultado = vendaServico.finalizar(
      {
        itens: comanda.itens.map((it) => ({
          produtoId: it.produto_id,
          precoUnitCentavos: it.preco_unit_centavos,
          qtdMilesimal: it.qtd_milesimal
        })),
        pagamentos,
        operador,
        observacoes: observacoes ||
          `Comanda: ${comanda.identificador}${comanda.cliente_nome ? ` · ${comanda.cliente_nome}` : ''}`
      },
      { log }
    );

    comandasRepo.marcarFechada(comandaId, { vendaId: resultado.vendaId, em: agoraTimestamp() });

    return { ...resultado, identificador: comanda.identificador, clienteNome: comanda.cliente_nome };
  })();
}
