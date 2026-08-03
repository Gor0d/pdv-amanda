import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, toast, confirmar } from '../lib/dom.js';
import { formatarQtd } from '/compartilhado/formato/moeda.js';

const CAMPOS_CONFIG = [
  'loja_nome', 'loja_cnpj', 'loja_endereco', 'loja_telefone',
  'operador_padrao', 'estoque_minimo_alerta'
];

let aoMudarConfig = null;

export function montar({ aoMudar } = {}) {
  aoMudarConfig = aoMudar;
  const secao = $('#tab-ajustes');

  aoClicar(secao, '[data-acao]', (el) => {
    const acao = el.dataset.acao;
    if (acao === 'salvar-config') salvarConfig();
    if (acao === 'importar') importar();
    if (acao === 'backup') backup();
    if (acao === 'abrir-pasta') api.sistema.abrirPasta('pdv').catch(() => {});
    if (acao === 'recalcular') recalcular();
  });
}

export async function aoEntrar() {
  const cfg = await tentar(() => api.config.obterTudo());
  if (cfg) for (const c of CAMPOS_CONFIG) { const el = $(`#cfg-${c}`); if (el) el.value = cfg[c] ?? ''; }
  await mostrarInfo();
}

async function salvarConfig() {
  const dados = Object.fromEntries(CAMPOS_CONFIG.map((c) => [c, $(`#cfg-${c}`).value.trim()]));
  const ok = await tentar(() => api.config.definirVarios(dados),
    { aoFalhar: (e) => mostrarMsg('#cfg-msg', e.message, 'err') });
  if (ok === undefined) return;
  mostrarMsg('#cfg-msg', 'Dados salvos.', 'ok', 4);
  aoMudarConfig?.();
}

async function importar() {
  const r = await tentar(() => api.sistema.importarArquivo(),
    { aoFalhar: (e) => mostrarMsg('#import-msg', e.message, 'err', 0) });
  if (r === undefined) return;
  if (r === null) return; // o operador fechou o seletor de arquivo

  if (r.jaImportado) {
    mostrarMsg('#import-msg', 'Este arquivo já tinha sido importado antes. Nada foi duplicado.', 'warn', 0);
  } else {
    mostrarMsg('#import-msg', 'Importação concluída.', 'ok', 0);
  }

  $('#import-relatorio').innerHTML = `
    <div class="esp-topo-p">
      <div class="linha-info"><span class="rotulo">Produtos cadastrados</span><span class="valor">${r.produtosCriados}</span></div>
      <div class="linha-info"><span class="rotulo">Vendas trazidas</span><span class="valor">${r.vendasCriadas}</span></div>
      ${r.produtosDuplicados ? `<div class="linha-info"><span class="rotulo">Códigos repetidos (estoques somados)</span><span class="valor">${r.produtosDuplicados}</span></div>` : ''}
      ${r.itensSemProduto ? `<div class="linha-info"><span class="rotulo">Itens de produtos já excluídos</span><span class="valor">${r.itensSemProduto}</span></div>` : ''}
    </div>
    ${r.avisos?.length ? `
      <details class="esp-topo-p">
        <summary class="lista-avisos-resumo">
          Ver ${r.totalAvisos} aviso(s) da importação
        </summary>
        <ul class="lista-avisos">
          ${r.avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}
        </ul>
      </details>` : ''}
  `;

  aoMudarConfig?.();
}

async function backup() {
  const r = await tentar(() => api.sistema.backupAgora(),
    { aoFalhar: (e) => mostrarMsg('#sys-msg', e.message, 'err') });
  if (r === undefined) return;
  mostrarMsg('#sys-msg', `Backup salvo em ${r.pasta}`, 'ok', 8);
  await mostrarInfo();
  aoMudarConfig?.();
}

async function recalcular() {
  const divergentes = await tentar(() => api.estoque.recalcularCache());
  if (divergentes === undefined) return;

  if (!divergentes.length) {
    mostrarMsg('#sys-msg', 'Estoque conferido: tudo bate com o histórico de movimentações.', 'ok', 6);
    return;
  }
  mostrarMsg(
    '#sys-msg',
    `${divergentes.length} produto(s) estavam com o saldo errado e foram corrigidos: ` +
      divergentes.map((d) => `${d.nome} (${formatarQtd(d.cache)} → ${formatarQtd(d.ledger)})`).join(', '),
    'warn',
    0
  );
}

async function mostrarInfo() {
  const info = await tentar(() => api.sistema.info(), { aoFalhar: () => {} });
  if (!info) return;
  $('#sys-info').innerHTML = `
    <div class="linha-info"><span class="rotulo">Versão do sistema</span><span class="valor">${escapar(info.versaoApp)}</span></div>
    <div class="linha-info"><span class="rotulo">Versão do banco de dados</span><span class="valor">${info.versaoEsquema}</span></div>
    <div class="linha-info"><span class="rotulo">Arquivo de dados</span><span class="valor">${escapar(info.caminhoBanco)}</span></div>
    <div class="linha-info"><span class="rotulo">Pasta de backups</span><span class="valor">${escapar(info.pastaPdv)}</span></div>
    <div class="linha-info"><span class="rotulo">Último backup</span><span class="valor">${
      info.ultimoBackup ? escapar(new Date(info.ultimoBackup.em).toLocaleString('pt-BR')) : 'nenhum ainda'
    }</span></div>
  `;
}
