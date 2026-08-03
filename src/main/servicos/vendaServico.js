import { randomUUID } from 'node:crypto';
import { obterBanco } from '../db/conexao.js';
import * as vendasRepo from '../repos/vendasRepo.js';
import * as produtosRepo from '../repos/produtosRepo.js';
import * as estoqueRepo from '../repos/estoqueRepo.js';
import * as configRepo from '../repos/configRepo.js';
import { calcularTotais, calcularPagamento } from '../../compartilhado/calculos/totais.js';
import { agoraTimestamp, agoraHora, hojeISO } from '../../compartilhado/formato/data.js';
import { ErroNegocio, CODIGOS } from '../util/erros.js';

/**
 * Finaliza uma venda. Tudo numa única transação: ou a venda inteira existe
 * (cabeçalho, itens, pagamentos, baixa de estoque) ou nada aconteceu.
 *
 * Os totais que chegam do renderer são IGNORADOS para gravação — recalculamos
 * aqui a partir dos itens. Se divergirem, gravamos o nosso e registramos aviso:
 * é sintoma de bug na tela, não motivo para recusar a venda no balcão.
 *
 * @param {{itens:Array, descontoVenda?:object, acrescimoCentavos?:number,
 *          pagamentos:Array, clienteId?:number, operador?:string,
 *          observacoes?:string, totalEsperadoCentavos?:number}} entrada
 */
export function finalizar(entrada, { log = console } = {}) {
  const db = obterBanco();

  if (!entrada?.itens?.length) {
    throw new ErroNegocio(CODIGOS.CARRINHO_VAZIO, 'Não há itens para finalizar a venda.');
  }

  return db.transaction(() => {
    // 1. Resolver cada item contra o cadastro atual e montar o snapshot.
    const itens = entrada.itens.map((it, idx) => {
      const p = produtosRepo.porId(it.produtoId);
      if (!p) {
        throw new ErroNegocio(
          CODIGOS.PRODUTO_NAO_ENCONTRADO,
          `O produto da linha ${idx + 1} não existe mais no cadastro.`
        );
      }
      return {
        seq: idx + 1,
        produto: p,
        codigoBarras: it.codigoBarras ?? null,
        // Preço vem da tela porque a linha pode ter sido aberta antes de uma
        // troca de preço no cadastro; o snapshot é o que o cliente viu.
        precoUnitCentavos: Math.trunc(it.precoUnitCentavos ?? p.preco_centavos),
        qtdMilesimal: Math.trunc(it.qtdMilesimal),
        descontoItemCentavos: Math.trunc(it.descontoItemCentavos || 0)
      };
    });

    // 2. Recalcular os totais aqui, no main.
    const totais = calcularTotais(itens, entrada.descontoVenda, entrada.acrescimoCentavos);
    if (
      entrada.totalEsperadoCentavos != null &&
      entrada.totalEsperadoCentavos !== totais.totalCentavos
    ) {
      log.warn?.(
        `Total divergente: tela=${entrada.totalEsperadoCentavos} banco=${totais.totalCentavos}. ` +
        'Gravando o valor calculado no main.'
      );
    }

    // 3. Conferir os pagamentos contra o total recalculado.
    const pagamentos = (entrada.pagamentos || []).map((p) => ({
      forma: p.forma,
      valorCentavos: Math.trunc(p.valorCentavos),
      recebidoCentavos: p.recebidoCentavos != null ? Math.trunc(p.recebidoCentavos) : null,
      bandeira: p.bandeira ?? null,
      parcelas: p.parcelas ?? 1,
      autorizacao: p.autorizacao ?? null
    }));
    const situacao = calcularPagamento(totais.totalCentavos, pagamentos);
    if (!situacao.completo) {
      throw new ErroNegocio(
        CODIGOS.PAGAMENTO_INCOMPLETO,
        situacao.faltaCentavos > 0
          ? 'Os pagamentos informados não cobrem o total da venda.'
          : 'Os pagamentos informados passam do total da venda.',
        { faltaCentavos: situacao.faltaCentavos, totalCentavos: totais.totalCentavos }
      );
    }

    // 4. Conferir estoque antes de gravar qualquer coisa.
    const permiteNegativo = configRepo.obterBooleano('estoque_negativo_permitido');
    if (!permiteNegativo) {
      for (const it of itens) {
        if (it.produto.controla_estoque && it.produto.estoque_milesimal < it.qtdMilesimal) {
          throw new ErroNegocio(
            CODIGOS.ESTOQUE_INSUFICIENTE,
            `"${it.produto.nome}" não tem estoque suficiente.`,
            { produtoId: it.produto.id, disponivelMilesimal: it.produto.estoque_milesimal }
          );
        }
      }
    }

    // 5. Gravar cabeçalho.
    const ts = agoraTimestamp();
    const numero = vendasRepo.proximoNumero();
    const vendaId = vendasRepo.inserirVenda({
      numero,
      uuid: randomUUID(),
      sessao_id: entrada.sessaoId ?? null,
      cliente_id: entrada.clienteId ?? null,
      status: 'finalizada',
      subtotal_centavos: totais.subtotalCentavos,
      desconto_itens_centavos: totais.descontoItensCentavos,
      desconto_venda_centavos: totais.descontoVendaCentavos,
      desconto_venda_tipo: entrada.descontoVenda?.tipo ?? null,
      desconto_venda_percent: entrada.descontoVenda?.percentual ?? null,
      acrescimo_centavos: totais.acrescimoCentavos,
      total_centavos: totais.totalCentavos,
      troco_centavos: situacao.trocoCentavos,
      operador: entrada.operador || configRepo.obter('operador_padrao', 'Operador'),
      observacoes: entrada.observacoes ?? null,
      criado_em: ts,
      data: hojeISO(),
      hora: agoraHora(),
      origem: 'pdv'
    });

    // 6. Itens + baixa no ledger de estoque.
    itens.forEach((it, i) => {
      const calc = totais.itens[i];
      vendasRepo.inserirItem({
        venda_id: vendaId,
        seq: it.seq,
        produto_id: it.produto.id,
        codigo_barras: it.codigoBarras,
        descricao: it.produto.nome,
        unidade: it.produto.unidade,
        preco_unit_centavos: it.precoUnitCentavos,
        qtd_milesimal: it.qtdMilesimal,
        desconto_item_centavos: calc.descontoItemCentavos,
        rateio_desconto_venda_centavos: calc.rateioDescontoVendaCentavos,
        total_item_centavos: calc.totalItemCentavos,
        custo_unit_centavos: it.produto.custo_centavos ?? null
      });

      estoqueRepo.lancar(it.produto.id, 'venda', -it.qtdMilesimal, {
        vendaId,
        custoUnitCentavos: it.produto.custo_centavos ?? null,
        criadoPor: entrada.operador ?? null
      });
    });

    // 7. Pagamentos.
    for (const p of pagamentos) {
      const trocoDaLinha =
        p.forma === 'dinheiro' && p.recebidoCentavos != null
          ? Math.max(0, p.recebidoCentavos - p.valorCentavos)
          : 0;
      vendasRepo.inserirPagamento({
        venda_id: vendaId,
        forma: p.forma,
        valor_centavos: p.valorCentavos,
        valor_recebido_centavos: p.recebidoCentavos,
        troco_centavos: trocoDaLinha,
        bandeira: p.bandeira,
        parcelas: p.parcelas,
        autorizacao: p.autorizacao,
        criado_em: ts
      });
    }

    // 8. A venda foi gravada: o rascunho de recuperação não serve mais.
    vendasRepo.limparRascunho();

    return { vendaId, numero, totais, trocoCentavos: situacao.trocoCentavos };
  })();
}

/**
 * Cancela uma venda finalizada, revertendo o estoque. Nada é apagado: a venda
 * fica com status 'cancelada' e o estorno entra como movimento novo no ledger.
 */
export function cancelar({ vendaId, motivo, por, sessaoAtualId = null }, { log = console } = {}) {
  const db = obterBanco();

  if (!motivo || !String(motivo).trim()) {
    throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'Informe o motivo do cancelamento.');
  }

  return db.transaction(() => {
    const venda = vendasRepo.porId(vendaId);
    if (!venda) throw new ErroNegocio(CODIGOS.VENDA_NAO_ENCONTRADA, 'Venda não encontrada.');
    if (venda.status === 'cancelada') {
      throw new ErroNegocio(CODIGOS.VENDA_JA_CANCELADA, `A venda ${venda.numero} já está cancelada.`);
    }

    for (const item of venda.itens) {
      if (item.produto_id) {
        estoqueRepo.lancar(item.produto_id, 'estorno_venda', item.qtd_milesimal, {
          vendaId,
          motivo: `Cancelamento da venda ${venda.numero}`,
          criadoPor: por ?? null
        });
      }
    }

    vendasRepo.marcarCancelada({
      vendaId,
      motivo: String(motivo).trim(),
      por: por ?? null,
      sessaoAtualId,
      em: agoraTimestamp()
    });

    log.info?.(`Venda ${venda.numero} cancelada por ${por ?? 'desconhecido'}: ${motivo}`);
    return { vendaId, numero: venda.numero, totalCentavos: venda.total_centavos };
  })();
}
