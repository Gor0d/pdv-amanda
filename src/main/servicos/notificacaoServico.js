import electron from 'electron'; // ver comentário em util/caminhos.js
import * as relatoriosRepo from '../repos/relatoriosRepo.js';
import * as configRepo from '../repos/configRepo.js';
import { hojeISO, somarDiasISO, formatarDataBR } from '../../compartilhado/formato/data.js';

const { Notification } = electron;
const CHAVE_ULTIMO_AVISO = 'validade_aviso_em';
const DIAS_ALERTA = 10;

/**
 * Notificação nativa (toast do Windows) avisando de produtos com estoque que
 * vencem nos próximos 10 dias — no máximo uma vez por dia, mesmo que o app
 * fique aberto a noite toda ou seja reaberto várias vezes.
 */
export function verificarValidadesProximas({ log = console } = {}) {
  try {
    const hoje = hojeISO();
    if (configRepo.obter(CHAVE_ULTIMO_AVISO) === hoje) return;

    const limite = somarDiasISO(hoje, DIAS_ALERTA);
    const produtos = relatoriosRepo.produtosAVencer(limite);
    if (!produtos.length) return;

    if (!Notification.isSupported()) {
      // Não marca como avisado: se o suporte a notificação vier a existir
      // (troca de máquina, driver, config do Windows), a próxima checagem
      // periódica tenta de novo em vez de ficar presa nesse estado pra sempre.
      log.warn?.('Notificação de validade pulada: sistema não suporta notificações nativas.');
      return;
    }

    const corpo = produtos.length === 1
      ? `${produtos[0].nome} vence em ${formatarDataBR(produtos[0].validade)}.`
      : `${produtos.length} produtos com estoque vencem até ${formatarDataBR(limite)}: ` +
        produtos.slice(0, 3).map((p) => p.nome).join(', ') + (produtos.length > 3 ? '...' : '');

    new Notification({
      title: 'Produtos perto do vencimento',
      body: corpo
    }).show();

    // Só marca como avisado DEPOIS do show() não ter lançado — se alguma
    // exceção acontecer antes daqui, o catch abaixo pega e a próxima
    // checagem tenta de novo, em vez de ficar calada o dia inteiro.
    configRepo.definir(CHAVE_ULTIMO_AVISO, hoje);
    log.info?.(`Aviso de validade enviado: ${produtos.length} produto(s).`);
  } catch (e) {
    log.error?.('Falha ao verificar validades próximas', e);
  }
}
