// Único arquivo CommonJS do projeto: com `sandbox: true` o preload não pode
// ser ESM. Ele não tem lógica nenhuma — só expõe canais nomeados — então não
// perde nada por isso.
//
// Este arquivo é o contrato inteiro entre a tela e o resto do sistema. Nada
// além do que está aqui atravessa a fronteira: o renderer não tem acesso a
// `require`, ao sistema de arquivos nem ao banco.

const { contextBridge, ipcRenderer } = require('electron');

const chamar = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('pdv', {
  produtos: {
    listar: chamar('produtos:listar'),
    porId: chamar('produtos:porId'),
    buscarPorCodigo: chamar('produtos:buscarPorCodigo'),
    criar: chamar('produtos:criar'),
    atualizar: chamar('produtos:atualizar'),
    inativar: chamar('produtos:inativar'),
    codigos: chamar('produtos:codigos'),
    adicionarCodigo: chamar('produtos:adicionarCodigo'),
    removerCodigo: chamar('produtos:removerCodigo')
  },

  estoque: {
    entrada: chamar('estoque:entrada'),
    ajustar: chamar('estoque:ajustar'),
    movimentos: chamar('estoque:movimentos'),
    recalcularCache: chamar('estoque:recalcularCache')
  },

  vendas: {
    finalizar: chamar('vendas:finalizar'),
    cancelar: chamar('vendas:cancelar'),
    porId: chamar('vendas:porId'),
    listarDoPeriodo: chamar('vendas:listarDoPeriodo'),
    rascunhoSalvar: chamar('vendas:rascunhoSalvar'),
    rascunhoLer: chamar('vendas:rascunhoLer'),
    rascunhoLimpar: chamar('vendas:rascunhoLimpar')
  },

  relatorios: {
    doPeriodo: chamar('relatorios:doPeriodo'),
    diasComVenda: chamar('relatorios:diasComVenda'),
    estoqueAtual: chamar('relatorios:estoqueAtual')
  },

  config: {
    obterTudo: chamar('config:obterTudo'),
    definirVarios: chamar('config:definirVarios')
  },

  sistema: {
    info: chamar('sistema:info'),
    importarArquivo: chamar('sistema:importarArquivo'),
    backupAgora: chamar('sistema:backupAgora'),
    abrirPasta: chamar('sistema:abrirPasta')
  }
});
