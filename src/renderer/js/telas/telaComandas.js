import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, toast, abrirModal, fecharModal } from '../lib/dom.js';
import { escolherPagamento } from '../lib/pagamento.js';
import { formatarBRL, formatarQtd, paraMilesimal } from '/compartilhado/formato/moeda.js';
import { formatarDataHoraBR } from '/compartilhado/formato/data.js';

// Comanda aberta no modal no momento — só uma por vez, igual ao resto do app
// (um único #modal global). Guardamos aqui pra poder re-renderizar o corpo do
// modal sem reabri-lo a cada item lançado.
let comandaAtualId = null;

/** "Mesa 4" ou "Mesa 4 · João", conforme o cliente tiver sido identificado. */
function rotuloComanda(c) {
  return c.cliente_nome ? `${c.identificador} · ${c.cliente_nome}` : c.identificador;
}

export function montar() {
  const secao = $('#tab-comandas');

  aoClicar(secao, '[data-acao]', (el) => {
    if (el.dataset.acao === 'abrir-comanda') abrirComanda();
    if (el.dataset.acao === 'ver-comanda') abrirDetalhe(Number(el.dataset.id));
  });

  for (const campo of ['#cm-identificador', '#cm-cliente']) {
    $(campo).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); abrirComanda(); }
    });
  }
}

export function aoEntrar() {
  renderizarLista();
}

async function renderizarLista() {
  const lista = await tentar(() => api.comandas.listarAbertas());
  const el = $('#cm-lista');
  if (lista === undefined) return;

  if (!lista.length) {
    el.innerHTML = '<div class="empty-state">Nenhuma comanda aberta agora. Abra uma acima para começar a lançar os pedidos.</div>';
    return;
  }

  el.innerHTML = lista.map((c) => `
    <div class="comanda-card" data-acao="ver-comanda" data-id="${c.id}">
      <div class="identificador">${escapar(rotuloComanda(c))}</div>
      <div class="info">
        <span>${c.qtd_itens} ite${c.qtd_itens === 1 ? 'm' : 'ns'}</span>
        <span class="total">${formatarBRL(c.total_centavos)}</span>
      </div>
    </div>
  `).join('');
}

async function abrirComanda() {
  const identificador = $('#cm-identificador').value.trim();
  const clienteNome = $('#cm-cliente').value.trim();
  if (!identificador) return mostrarMsg('#cm-msg', 'Informe a mesa ou o nome do cliente.', 'err');

  const id = await tentar(
    () => api.comandas.abrir({ identificador, clienteNome: clienteNome || null }),
    { aoFalhar: (e) => mostrarMsg('#cm-msg', e.message, 'err') }
  );
  if (id === undefined) return;

  $('#cm-identificador').value = '';
  $('#cm-cliente').value = '';
  toast(`Comanda "${identificador}${clienteNome ? ' · ' + clienteNome : ''}" aberta.`);
  await renderizarLista();
  abrirDetalhe(id);
}

// -------------------------------- Detalhe --------------------------------

async function abrirDetalhe(comandaId) {
  comandaAtualId = comandaId;
  const comanda = await tentar(() => api.comandas.porId(comandaId));
  if (!comanda) return;

  abrirModal(`
    <div class="comanda-modal">
      <h3>${escapar(rotuloComanda(comanda))}</h3>
      <div class="sub">Aberta em ${formatarDataHoraBR(comanda.aberta_em)}</div>

      <div class="scan-row">
        <input id="cm-add-termo" type="text" autocomplete="off" placeholder="Digite o nome do produto...">
      </div>
      <div id="cm-add-lista" class="lista-rolagem"></div>
      <div id="cm-add-msg" class="msg"></div>

      <div id="cm-itens" class="esp-topo"></div>

      <div class="rtotal">
        <span class="label">Total</span>
        <span class="amount" id="cm-total">R$ 0,00</span>
      </div>

      <div class="btn-row">
        <button class="btn btn-ghost" data-r="voltar">Voltar</button>
        <button class="btn btn-primary" data-r="fechar">Fechar comanda e cobrar</button>
      </div>
    </div>
  `, {
    async aoMontar(caixa) {
      const termo = caixa.querySelector('#cm-add-termo');
      const listaEl = caixa.querySelector('#cm-add-lista');
      let resultados = [];
      let ativo = 0;

      const desenharBusca = () => {
        if (!termo.value.trim()) { listaEl.innerHTML = ''; return; }
        if (!resultados.length) {
          listaEl.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
          return;
        }
        listaEl.innerHTML = resultados.map((p, i) => `
          <div class="rline ${i === ativo ? 'selecionada' : ''}" data-i="${i}">
            <span class="name">${escapar(p.nome)}</span>
            <span class="leader"></span>
            <span class="price">${formatarBRL(p.preco_centavos)}</span>
          </div>
        `).join('');
      };

      const buscar = async () => {
        const v = termo.value.trim();
        resultados = v ? (await tentar(() => api.produtos.listar({ termo: v, limite: 20 }))) || [] : [];
        ativo = 0;
        desenharBusca();
      };

      const escolher = async (i) => {
        const p = resultados[i];
        if (!p) return;
        await lancarItem(p.id, 1000, caixa);
        termo.value = '';
        resultados = [];
        desenharBusca();
        termo.focus();
      };

      termo.addEventListener('input', buscar);
      termo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); ativo = Math.min(resultados.length - 1, ativo + 1); desenharBusca(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(0, ativo - 1); desenharBusca(); }
        if (e.key === 'Enter') { e.preventDefault(); escolher(ativo); }
      });
      listaEl.addEventListener('click', (e) => {
        const linha = e.target.closest('[data-i]');
        if (linha) escolher(Number(linha.dataset.i));
      });

      // Delegar no wrapper (recriado a cada abertura do modal), nunca em
      // `caixa` (#modal é reaproveitado entre aberturas — um listener nele
      // acumularia a cada vez que a comanda fosse reaberta, e um clique
      // acabaria disparando o lançamento várias vezes de uma vez só).
      caixa.querySelector('.comanda-modal').addEventListener('click', (e) => {
        const el = e.target.closest('[data-acao]');
        if (!el) return;
        if (el.dataset.acao === 'remover-item') removerItem(Number(el.dataset.id), caixa);
        if (el.dataset.acao === 'mais-item') alterarQtdItem(caixa, el, +1000);
        if (el.dataset.acao === 'menos-item') alterarQtdItem(caixa, el, -1000);
      });

      caixa.querySelector('[data-r="voltar"]').addEventListener('click', () => { fecharModal(); renderizarLista(); });
      caixa.querySelector('[data-r="fechar"]').addEventListener('click', () => fecharComanda(caixa));
      caixa._aoEscape = () => { fecharModal(); renderizarLista(); };

      await renderizarItens(caixa);
      termo.focus();
    }
  });
}

async function renderizarItens(caixa) {
  const comanda = await tentar(() => api.comandas.porId(comandaAtualId));
  if (!comanda) return;

  const itensEl = caixa.querySelector('#cm-itens');
  let total = 0;

  if (!comanda.itens.length) {
    itensEl.innerHTML = '<div class="empty-state">Nenhum item lançado ainda.</div>';
  } else {
    itensEl.innerHTML = comanda.itens.map((i) => {
      const totalItem = Math.round((i.preco_unit_centavos * i.qtd_milesimal) / 1000);
      total += totalItem;
      return `
        <div class="rline">
          <span class="name" title="${escapar(i.descricao)}">${escapar(i.descricao)}</span>
          <span class="leader"></span>
          <span class="qty-ctrl">
            <button data-acao="menos-item" data-id="${i.id}" data-produto="${i.produto_id}" data-preco="${i.preco_unit_centavos}" title="Diminuir">−</button>
            <span class="mono qty">${formatarQtd(i.qtd_milesimal)}</span>
            <button data-acao="mais-item" data-id="${i.id}" data-produto="${i.produto_id}" data-preco="${i.preco_unit_centavos}" title="Aumentar">+</button>
          </span>
          <span class="price">${formatarBRL(totalItem)}</span>
          <span class="rm" data-acao="remover-item" data-id="${i.id}" title="Remover">✕</span>
        </div>`;
    }).join('');
  }

  caixa.querySelector('#cm-total').textContent = formatarBRL(total);
}

async function lancarItem(produtoId, qtdMilesimal, caixa) {
  const r = await tentar(
    () => api.comandas.adicionarItem(comandaAtualId, { produtoId, qtdMilesimal }),
    { aoFalhar: (e) => mostrarMsg(caixa.querySelector('#cm-add-msg'), e.message, 'err') }
  );
  if (r === undefined) return;
  await renderizarItens(caixa);
}

async function alterarQtdItem(caixa, botao, delta) {
  // Não existe "editar quantidade" direto no item: lançar de novo soma na
  // mesma linha (mesmo produto + mesmo preço), e remover é sempre a linha
  // inteira — então o "−" remove e relança com uma unidade a menos.
  const produtoId = Number(botao.dataset.produto);
  const itemId = Number(botao.dataset.id);

  if (delta > 0) {
    await lancarItem(produtoId, delta, caixa);
    return;
  }

  const comanda = await tentar(() => api.comandas.porId(comandaAtualId));
  const item = comanda?.itens.find((i) => i.id === itemId);
  if (!item) return;

  if (item.qtd_milesimal + delta <= 0) {
    await removerItem(itemId, caixa);
    return;
  }

  await tentar(() => api.comandas.removerItem(itemId));
  await tentar(() => api.comandas.adicionarItem(comandaAtualId, {
    produtoId, qtdMilesimal: item.qtd_milesimal + delta
  }));
  await renderizarItens(caixa);
}

async function removerItem(itemId, caixa) {
  await tentar(() => api.comandas.removerItem(itemId));
  await renderizarItens(caixa);
}

async function fecharComanda(caixa) {
  const comanda = await tentar(() => api.comandas.porId(comandaAtualId));
  if (!comanda) return;
  if (!comanda.itens.length) {
    toast('Lance ao menos um item antes de fechar a comanda.', 'err');
    return;
  }

  const total = comanda.itens.reduce(
    (soma, i) => soma + Math.round((i.preco_unit_centavos * i.qtd_milesimal) / 1000), 0
  );

  // escolherPagamento() usa o mesmo #modal global da tela de itens — ao
  // responder, o conteúdo anterior já foi substituído. Se a pessoa recuar,
  // reabrimos a comanda do zero em vez de deixar o modal vazio.
  const pagamento = await escolherPagamento(total);
  if (!pagamento) { abrirDetalhe(comandaAtualId); return; }

  const r = await tentar(
    () => api.comandas.fechar(comandaAtualId, {
      pagamentos: [{
        forma: pagamento.forma,
        valorCentavos: pagamento.valorCentavos,
        recebidoCentavos: pagamento.recebidoCentavos
      }]
    }),
    { aoFalhar: (e) => toast(e.message, 'err') }
  );
  if (r === undefined) return;

  fecharModal();
  toast(`Comanda "${rotuloComanda({ identificador: r.identificador, cliente_nome: r.clienteNome })}" fechada — ` +
        `venda ${String(r.numero).padStart(6, '0')}, ${formatarBRL(r.totais.totalCentavos)}.`);
  renderizarLista();
}
