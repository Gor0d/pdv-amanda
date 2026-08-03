import electron from 'electron'; // ver comentário em util/caminhos.js
import fs from 'node:fs';

const { ipcMain, dialog, shell, app } = electron;
import * as produtosRepo from '../repos/produtosRepo.js';
import * as estoqueRepo from '../repos/estoqueRepo.js';
import * as vendasRepo from '../repos/vendasRepo.js';
import * as relatoriosRepo from '../repos/relatoriosRepo.js';
import * as configRepo from '../repos/configRepo.js';
import * as vendaServico from '../servicos/vendaServico.js';
import { importar } from '../servicos/importacaoServico.js';
import { backupAgora, ultimoBackup } from '../servicos/backupServico.js';
import { obterBanco } from '../db/conexao.js';
import { caminhoBanco, pastaPdv } from '../util/caminhos.js';
import { ErroNegocio, CODIGOS, paraResposta } from '../util/erros.js';
import { agoraTimestamp } from '../../compartilhado/formato/data.js';

/**
 * Registra todos os canais. Cada handler devolve sempre
 *   { ok: true, dados } | { ok: false, codigo, mensagem }
 * para que o renderer nunca precise de try/catch em volta de cada chamada e
 * nunca receba uma stack trace.
 */
export function registrarIpc({ log = console } = {}) {
  const canal = (nome, fn) => {
    ipcMain.handle(nome, async (_evento, ...args) => {
      try {
        return { ok: true, dados: await fn(...args) };
      } catch (e) {
        return paraResposta(e, log);
      }
    });
  };

  // ------------------------------ Produtos ------------------------------
  canal('produtos:listar', (filtro) => produtosRepo.listar(filtro || {}));
  canal('produtos:porId', (id) => produtosRepo.porId(id));
  canal('produtos:buscarPorCodigo', (codigo) => produtosRepo.buscarPorCodigo(codigo));
  canal('produtos:codigos', (id) => produtosRepo.codigosDe(id));

  canal('produtos:criar', (dados) => {
    validarProduto(dados);
    for (const c of dados.codigos || []) {
      const dono = produtosRepo.donoDoCodigo(c);
      if (dono) {
        const p = produtosRepo.porId(dono.produto_id);
        throw new ErroNegocio(
          CODIGOS.CODIGO_DUPLICADO,
          `O código ${c} já pertence a "${p?.nome ?? 'outro produto'}".`
        );
      }
    }
    return produtosRepo.criar(dados);
  });

  canal('produtos:atualizar', (id, dados) => {
    validarProduto(dados);
    if (!produtosRepo.porId(id)) {
      throw new ErroNegocio(CODIGOS.PRODUTO_NAO_ENCONTRADO, 'Produto não encontrado.');
    }
    produtosRepo.atualizar(id, dados);
    return true;
  });

  canal('produtos:inativar', (id) => {
    produtosRepo.inativar(id);
    return true;
  });

  canal('produtos:adicionarCodigo', (produtoId, codigo) => {
    const limpo = String(codigo || '').trim();
    if (!limpo) throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'Informe o código de barras.');
    const dono = produtosRepo.donoDoCodigo(limpo);
    if (dono) {
      const p = produtosRepo.porId(dono.produto_id);
      throw new ErroNegocio(
        CODIGOS.CODIGO_DUPLICADO,
        `O código ${limpo} já pertence a "${p?.nome ?? 'outro produto'}".`
      );
    }
    const jaTem = produtosRepo.codigosDe(produtoId).length > 0;
    produtosRepo.adicionarCodigo(produtoId, limpo, { principal: !jaTem });
    return true;
  });

  canal('produtos:removerCodigo', (codigoId) => {
    produtosRepo.removerCodigo(codigoId);
    return true;
  });

  // ------------------------------- Estoque ------------------------------
  canal('estoque:entrada', ({ produtoId, qtdMilesimal, motivo, custoUnitCentavos }) => {
    if (!(qtdMilesimal > 0)) {
      throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'A quantidade da entrada deve ser maior que zero.');
    }
    return obterBanco().transaction(() =>
      estoqueRepo.lancar(produtoId, 'entrada', qtdMilesimal, { motivo, custoUnitCentavos })
    )();
  });

  canal('estoque:ajustar', ({ produtoId, novoSaldoMilesimal, motivo }) => {
    if (!motivo || !String(motivo).trim()) {
      throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'Informe o motivo do ajuste de estoque.');
    }
    const p = produtosRepo.porId(produtoId);
    if (!p) throw new ErroNegocio(CODIGOS.PRODUTO_NAO_ENCONTRADO, 'Produto não encontrado.');
    const delta = novoSaldoMilesimal - p.estoque_milesimal;
    if (delta === 0) return p.estoque_milesimal;
    return obterBanco().transaction(() =>
      estoqueRepo.lancar(produtoId, 'ajuste', delta, { motivo: String(motivo).trim() })
    )();
  });

  canal('estoque:movimentos', (produtoId) => estoqueRepo.movimentosDe(produtoId));
  canal('estoque:recalcularCache', () => estoqueRepo.recalcularCache());

  // -------------------------------- Vendas ------------------------------
  canal('vendas:finalizar', (entrada) => vendaServico.finalizar(entrada, { log }));
  canal('vendas:cancelar', (entrada) => vendaServico.cancelar(entrada, { log }));
  canal('vendas:porId', (id) => vendasRepo.porId(id));
  canal('vendas:listarDoDia', (data) => vendasRepo.listarDoDia(data));
  canal('vendas:rascunhoSalvar', (json) => {
    vendasRepo.salvarRascunho(json, agoraTimestamp());
    return true;
  });
  canal('vendas:rascunhoLer', () => vendasRepo.lerRascunho());
  canal('vendas:rascunhoLimpar', () => {
    vendasRepo.limparRascunho();
    return true;
  });

  // ------------------------------ Relatórios ----------------------------
  canal('relatorios:doDia', (data) => ({
    resumo: relatoriosRepo.resumoDoDia(data),
    produtos: relatoriosRepo.produtosDoDia(data),
    formas: relatoriosRepo.porFormaPagamento(data)
  }));
  canal('relatorios:diasComVenda', (limite) => relatoriosRepo.diasComVenda(limite));
  canal('relatorios:estoqueAtual', () => relatoriosRepo.estoqueAtual());

  // ------------------------------- Config -------------------------------
  canal('config:obterTudo', () => configRepo.obterTudo());
  canal('config:definirVarios', (obj) => {
    configRepo.definirVarios(obj);
    return true;
  });

  // ------------------------------- Sistema ------------------------------
  canal('sistema:info', () => ({
    versaoApp: app.getVersion(),
    versaoElectron: process.versions.electron,
    versaoEsquema: obterBanco().pragma('user_version', { simple: true }),
    caminhoBanco: caminhoBanco(),
    pastaPdv: pastaPdv(),
    ultimoBackup: ultimoBackup()
  }));

  canal('sistema:importarArquivo', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Escolha o arquivo exportado do sistema anterior',
      filters: [{ name: 'Export do PDV', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const caminho = r.filePaths[0];
    return importar(fs.readFileSync(caminho, 'utf8'), { arquivo: caminho, log });
  });

  canal('sistema:backupAgora', () => backupAgora({ log }));

  canal('sistema:abrirPasta', (qual) => {
    shell.openPath(qual === 'banco' ? app.getPath('userData') : pastaPdv());
    return true;
  });
}

function validarProduto(d) {
  if (!d?.nome || !String(d.nome).trim()) {
    throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'Informe o nome do produto.');
  }
  if (!Number.isInteger(d.precoCentavos) || d.precoCentavos < 0) {
    throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'Informe um preço válido.');
  }
}
