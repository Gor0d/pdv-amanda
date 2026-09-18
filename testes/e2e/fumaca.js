// Teste de fumaça: sobe o app de verdade e opera a tela como o caixa operaria.
//
// Roda com `npm run smoke`. Usa uma pasta de dados descartável, então nunca
// encosta no banco da loja. É a única verificação que exercita o caminho
// completo tela → preload → IPC → serviço → SQLite → tela.

import electron from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const { app, BrowserWindow } = electron;

const dadosTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-smoke-'));
app.setPath('userData', dadosTemp);

const { abrirBanco } = await import('../../src/main/db/conexao.js');
const { registrarIpc } = await import('../../src/main/ipc/registrarIpc.js');
const { registrarEsquemaPrivilegiado, registrarProtocolo, criarJanela } = await import('../../src/main/janela.js');
const { caminhoBanco } = await import('../../src/main/util/caminhos.js');

const silencioso = { info() {}, warn() {}, error() {}, debug() {} };
const passos = [];
let falhas = 0;

function verificar(descricao, condicao, detalhe = '') {
  passos.push({ descricao, ok: !!condicao, detalhe });
  if (!condicao) falhas++;
  console.log(`${condicao ? '  ok' : 'NÃO OK'}  ${descricao}${condicao || !detalhe ? '' : ` — ${detalhe}`}`);
}

registrarEsquemaPrivilegiado();

app.whenReady().then(async () => {
  abrirBanco(caminhoBanco(), { log: silencioso });
  registrarProtocolo({ log: silencioso });
  registrarIpc({ log: silencioso });

  const win = criarJanela({ dev: false, log: silencioso });
  const wc = win.webContents;

  const erros = [];
  wc.on('console-message', (e) => { if (e.level === 'error') erros.push(e.message); });

  await new Promise((r) => wc.once('did-finish-load', r));
  await esperar(600); // deixa o iniciar() assíncrono terminar

  const exec = (js) => wc.executeJavaScript(js, true);

  try {
    // ---------------------------------------------------------------- boot
    verificar('a tela abriu na aba Vender', await exec(`document.querySelector('#tab-vender').classList.contains('active')`));
    verificar('o campo de bipagem está com o foco',
      await exec(`document.activeElement && document.activeElement.id === 'scan-input'`));
    verificar('a barra de status foi preenchida',
      await exec(`document.querySelector('#st-backup').textContent.trim() !== '—'`));

    // ------------------------------------------------------- cadastrar produto
    await exec(`
      (async () => {
        const r1 = await window.pdv.produtos.criar({ nome: 'Leite Integral 1L', precoCentavos: 549, codigos: ['7891000100103'] });
        await window.pdv.estoque.entrada({ produtoId: r1.dados, qtdMilesimal: 10000, motivo: 'smoke' });
        const r2 = await window.pdv.produtos.criar({ nome: 'Café 500g', precoCentavos: 1890, codigos: ['7891234567890'] });
        await window.pdv.estoque.entrada({ produtoId: r2.dados, qtdMilesimal: 5000, motivo: 'smoke' });
      })()
    `);

    // ---------------------------------------------------------------- bipar
    await biparNaTela(exec, '7891000100103');
    await biparNaTela(exec, '7891000100103');   // segunda unidade do mesmo item
    await biparNaTela(exec, '2*7891234567890'); // multiplicador de quantidade

    const linhas = await exec(`document.querySelectorAll('#receipt-body .rline').length`);
    verificar('o cupom mostra 2 linhas (item repetido foi agrupado)', linhas === 2, `linhas=${linhas}`);

    const total = await exec(`document.querySelector('#cart-total').textContent`);
    // 2 x 5,49 = 10,98  +  2 x 18,90 = 37,80  =>  48,78
    verificar('o total na tela está correto', total.includes('48,78'), `total exibido: ${total}`);

    // ------------------------------------------------- código não cadastrado
    await biparNaTela(exec, '9999999999999');
    const modalCadastro = await exec(`document.querySelector('#modal-fundo').classList.contains('show')`);
    verificar('código desconhecido oferece cadastro rápido', modalCadastro);
    await exec(`document.querySelector('#modal [data-r="cancelar"]').click()`);
    await esperar(120);

    // ------------------------------------------------------------- finalizar
    await exec(`document.querySelector('#btn-finalizar').click()`);
    await esperar(600);

    const totalDepois = await exec(`document.querySelector('#cart-total').textContent`);
    verificar('o carrinho zerou após finalizar', totalDepois.includes('0,00'), `total: ${totalDepois}`);

    const venda = await exec(`window.pdv.vendas.listarDoPeriodo(new Date().toISOString().slice(0,10))`);
    verificar('a venda foi gravada no banco', venda.ok && venda.dados.length === 1,
      `vendas encontradas: ${venda.dados?.length}`);
    verificar('o total gravado bate com o da tela', venda.dados?.[0]?.total_centavos === 4878,
      `gravado: ${venda.dados?.[0]?.total_centavos}`);

    // ---------------------------------------------------------- baixa de estoque
    const leite = await exec(`window.pdv.produtos.buscarPorCodigo('7891000100103')`);
    verificar('o estoque foi baixado', leite.dados?.produto?.estoque_milesimal === 8000,
      `estoque: ${leite.dados?.produto?.estoque_milesimal}`);

    // ------------------------------------------------------------ relatório
    await exec(`document.querySelector('[data-tab="relatorios"]').click()`);
    await esperar(500);
    const totalRelatorio = await exec(`document.querySelector('#rel-total').textContent`);
    verificar('o relatório do dia mostra a venda', totalRelatorio.includes('48,78'),
      `relatório: ${totalRelatorio}`);

    // ---------------------------------------------------------- cancelamento
    const vendaId = venda.dados[0].id;
    const cancelamento = await exec(
      `window.pdv.vendas.cancelar({ vendaId: ${vendaId}, motivo: 'teste de fumaça' })`
    );
    verificar('a venda pôde ser cancelada', cancelamento.ok, cancelamento.mensagem);

    const leiteDepois = await exec(`window.pdv.produtos.buscarPorCodigo('7891000100103')`);
    verificar('o cancelamento devolveu o estoque',
      leiteDepois.dados?.produto?.estoque_milesimal === 10000,
      `estoque: ${leiteDepois.dados?.produto?.estoque_milesimal}`);

    // ------------------------------------------------------- estoque na tela
    await exec(`document.querySelector('[data-tab="estoque"]').click()`);
    await esperar(400);
    const linhasEstoque = await exec(`document.querySelectorAll('#produtos-tabela tbody tr').length`);
    verificar('a aba Estoque lista os produtos', linhasEstoque === 2, `linhas=${linhasEstoque}`);

    // -------------------------------------------------------------- ajustes
    await exec(`document.querySelector('[data-tab="ajustes"]').click()`);
    await esperar(400);
    verificar('a aba Ajustes mostra o caminho do banco',
      (await exec(`document.querySelector('#sys-info').textContent`)).includes('pdv.db'));

    verificar('nenhum erro de console na tela', erros.length === 0, erros.join(' | '));
  } catch (e) {
    verificar('a execução terminou sem exceção', false, e.message);
  }

  console.log(`\n${passos.length - falhas}/${passos.length} verificações passaram`);

  // No Windows o arquivo fica travado enquanto a conexão estiver aberta.
  const { fecharBanco } = await import('../../src/main/db/conexao.js');
  fecharBanco();
  try {
    fs.rmSync(dadosTemp, { recursive: true, force: true });
  } catch {
    // Sobrou lixo em %TEMP%: irrelevante para o resultado do teste.
  }

  app.exit(falhas ? 1 : 0);
});

/** Simula o leitor: preenche o campo e dispara Enter, como o hardware faz. */
async function biparNaTela(exec, codigo) {
  await exec(`
    (() => {
      const el = document.querySelector('#scan-input');
      el.focus();
      el.value = ${JSON.stringify(codigo)};
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()
  `);
  await esperar(350);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
