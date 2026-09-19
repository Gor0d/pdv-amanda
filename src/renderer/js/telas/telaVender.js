import { api, tentar, ErroApi } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, toast, abrirModal, fecharModal, modalAberto, confirmar } from '../lib/dom.js';
import { escolherPagamento } from '../lib/pagamento.js';
import { formatarBRL, formatarQtd, paraMilesimal } from '/compartilhado/formato/moeda.js';
import { calcularTotais } from '/compartilhado/calculos/totais.js';
import { formatarDataBR, hojeISO, agoraHora } from '/compartilhado/formato/data.js';

// Carrinho: único estado de tela que sobrevive entre renders. É efêmero por
// natureza, mas tem snapshot no banco para não sumir numa queda de energia.
let carrinho = [];
let selecionado = 0;
let aoFinalizarCallback = null;

const scanInput = () => $('#scan-input');

export function montar({ aoFinalizar } = {}) {
  aoFinalizarCallback = aoFinalizar;
  const secao = $('#tab-vender');

  scanInput().addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const valor = scanInput().value.trim();
      scanInput().value = '';
      if (valor) bipar(valor);
    }
  });

  aoClicar(secao, '[data-acao]', (el) => {
    const acao = el.dataset.acao;
    if (acao === 'adicionar') {
      const valor = scanInput().value.trim();
      scanInput().value = '';
      if (valor) bipar(valor);
      focarScan();
    }
    if (acao === 'cancelar-venda') cancelarVenda();
    if (acao === 'finalizar') finalizar();
    if (acao === 'mais') alterarQtd(Number(el.dataset.i), +1000);
    if (acao === 'menos') alterarQtd(Number(el.dataset.i), -1000);
    if (acao === 'remover') removerItem(Number(el.dataset.i));
  });

  instalarAtalhos();
  instalarArmadilhaDeFoco();
  renderizar();
}

export function aoEntrar() {
  focarScan();
  renderizar();
}

export function focarScan() {
  const el = scanInput();
  if (el && !modalAberto()) el.focus();
}

/**
 * Armadilha de foco: se o operador clicou em qualquer lugar da tela e depois
 * bipou, o código se perderia. Aqui a primeira tecla imprimível devolve o foco
 * ao campo de bipagem sem engolir o caractere — é a falha operacional mais
 * comum num PDV.
 */
function instalarArmadilhaDeFoco() {
  document.addEventListener('keydown', (e) => {
    if (modalAberto()) return;
    if (!$('#tab-vender').classList.contains('active')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length !== 1) return;

    const alvo = e.target;
    const ehCampo = alvo.matches('input, textarea, select');
    if (!ehCampo) focarScan();
  }, true);
}

function instalarAtalhos() {
  document.addEventListener('keydown', (e) => {
    if (!$('#tab-vender').classList.contains('active')) return;
    if (modalAberto()) return;

    switch (e.key) {
      case 'F2': e.preventDefault(); abrirBuscaPorNome(); break;
      case 'F3': e.preventDefault(); pedirQuantidade(); break;
      case 'F7': e.preventDefault(); removerItem(selecionado); break;
      case 'F8': e.preventDefault(); finalizar(); break;
      case 'F12': e.preventDefault(); cancelarVenda(); break;
      case 'ArrowUp':
        if (carrinho.length) { e.preventDefault(); selecionado = Math.max(0, selecionado - 1); renderizar(); }
        break;
      case 'ArrowDown':
        if (carrinho.length) { e.preventDefault(); selecionado = Math.min(carrinho.length - 1, selecionado + 1); renderizar(); }
        break;
      case '+': case '=':
        if (carrinho.length && scanInput().value === '') { e.preventDefault(); alterarQtd(selecionado, +1000); }
        break;
      case '-':
        if (carrinho.length && scanInput().value === '') { e.preventDefault(); alterarQtd(selecionado, -1000); }
        break;
      case 'Escape':
        if (scanInput().value) { scanInput().value = ''; }
        break;
    }
  });
}

// ------------------------------- Bipagem --------------------------------

/**
 * Aceita "7891000100103" e também "3*7891000100103" — o multiplicador de
 * quantidade é memória muscular de quem opera caixa.
 */
async function bipar(entrada) {
  let quantidade = 1000;
  let codigo = entrada;

  const mult = entrada.match(/^(\d+(?:[.,]\d+)?)\s*[*x]\s*(.+)$/i);
  if (mult) {
    quantidade = paraMilesimal(mult[1]) ?? 1000;
    codigo = mult[2].trim();
  }

  const achado = await tentar(() => api.produtos.buscarPorCodigo(codigo));
  if (achado === undefined) return;

  if (!achado) {
    mostrarMsg('#scan-msg', `Produto com código "${codigo}" não está cadastrado.`, 'err');
    oferecerCadastroRapido(codigo);
    return;
  }

  const { produto, codigo: codigoEncontrado, fatorMilesimal } = achado;
  adicionarAoCarrinho(produto, codigoEncontrado, (quantidade * fatorMilesimal) / 1000);
}

function adicionarAoCarrinho(produto, codigoBarras, qtdMilesimal) {
  const existente = carrinho.find((i) => i.produtoId === produto.id);
  const jaNoCarrinho = existente?.qtdMilesimal ?? 0;

  if (produto.controla_estoque && produto.estoque_milesimal < jaNoCarrinho + qtdMilesimal) {
    mostrarMsg(
      '#scan-msg',
      `"${produto.nome}" não tem estoque suficiente (restam ${formatarQtd(produto.estoque_milesimal)}).`,
      'warn'
    );
    return;
  }

  if (existente) {
    existente.qtdMilesimal += qtdMilesimal;
    selecionado = carrinho.indexOf(existente);
  } else {
    carrinho.push({
      produtoId: produto.id,
      nome: produto.nome,
      unidade: produto.unidade,
      codigoBarras,
      precoUnitCentavos: produto.preco_centavos,
      qtdMilesimal,
      estoqueMilesimal: produto.estoque_milesimal,
      controlaEstoque: !!produto.controla_estoque
    });
    selecionado = carrinho.length - 1;
  }

  mostrarMsg('#scan-msg', `${produto.nome} — ${formatarBRL(produto.preco_centavos)}`, 'ok', 3);
  renderizar();
  focarScan();
}

function oferecerCadastroRapido(codigo) {
  abrirModal(`
    <h3>Cadastrar este produto?</h3>
    <div class="sub">O código <span class="mono">${escapar(codigo)}</span> não existe no cadastro.</div>
    <div class="grid-campos">
      <div><label for="qr-nome">Nome</label><input id="qr-nome" type="text" autocomplete="off"></div>
      <div class="grid-2">
        <div><label for="qr-preco">Preço (R$)</label><input id="qr-preco" type="text" inputmode="decimal" placeholder="0,00"></div>
        <div><label for="qr-estoque">Estoque</label><input id="qr-estoque" type="text" inputmode="decimal" placeholder="0"></div>
      </div>
    </div>
    <div id="qr-msg" class="msg"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" data-r="cancelar">Agora não</button>
      <button class="btn btn-primary" data-r="salvar">Cadastrar e adicionar</button>
    </div>
  `, {
    aoMontar(caixa) {
      caixa.querySelector('#qr-nome').focus();
      caixa.querySelector('[data-r="cancelar"]').addEventListener('click', () => { fecharModal(); focarScan(); });
      caixa.querySelector('[data-r="salvar"]').addEventListener('click', () => salvarCadastroRapido(codigo, caixa));
      caixa.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); salvarCadastroRapido(codigo, caixa); }
      });
      caixa._aoEscape = () => { fecharModal(); focarScan(); };
    }
  });
}

async function salvarCadastroRapido(codigo, caixa) {
  const { paraCentavos } = await import('/compartilhado/formato/moeda.js');
  const nome = caixa.querySelector('#qr-nome').value.trim();
  const precoCentavos = paraCentavos(caixa.querySelector('#qr-preco').value);
  const estoqueMilesimal = paraMilesimal(caixa.querySelector('#qr-estoque').value) ?? 0;

  if (!nome || precoCentavos === null) {
    mostrarMsg(caixa.querySelector('#qr-msg'), 'Informe pelo menos o nome e o preço.', 'err');
    return;
  }

  const id = await tentar(
    () => api.produtos.criar({ nome, precoCentavos, codigos: [codigo] }),
    { aoFalhar: (e) => mostrarMsg(caixa.querySelector('#qr-msg'), e.message, 'err') }
  );
  if (id === undefined) return;

  if (estoqueMilesimal > 0) {
    await tentar(() => api.estoque.entrada({
      produtoId: id, qtdMilesimal: estoqueMilesimal, motivo: 'Cadastro rápido no caixa'
    }));
  }

  fecharModal();
  const produto = await tentar(() => api.produtos.porId(id));
  if (produto) adicionarAoCarrinho(produto, codigo, 1000);
}

async function abrirBuscaPorNome() {
  abrirModal(`
    <h3>Buscar produto</h3>
    <div class="sub">Digite parte do nome. Use ↑ ↓ e Enter para adicionar.</div>
    <input id="bp-termo" type="text" autocomplete="off" placeholder="Ex.: leite">
    <div id="bp-lista" class="lista-rolagem"></div>
  `, {
    aoMontar(caixa) {
      const termo = caixa.querySelector('#bp-termo');
      const lista = caixa.querySelector('#bp-lista');
      let resultados = [];
      let ativo = 0;

      const desenhar = () => {
        if (!resultados.length) {
          lista.innerHTML = '<div class="empty-state">Nenhum produto encontrado.</div>';
          return;
        }
        lista.innerHTML = resultados.map((p, i) => `
          <div class="rline ${i === ativo ? 'selecionada' : ''}" data-i="${i}">
            <span class="name">${escapar(p.nome)}</span>
            <span class="leader"></span>
            <span class="mono txt-mini">${formatarQtd(p.estoque_milesimal)}</span>
            <span class="price">${formatarBRL(p.preco_centavos)}</span>
          </div>
        `).join('');
      };

      const buscar = async () => {
        resultados = (await tentar(() => api.produtos.listar({ termo: termo.value, limite: 30 }))) || [];
        ativo = 0;
        desenhar();
      };

      const escolher = async (i) => {
        const p = resultados[i];
        if (!p) return;
        fecharModal();
        const completo = await tentar(() => api.produtos.porId(p.id));
        if (completo) adicionarAoCarrinho(completo, p.codigo ?? null, 1000);
      };

      termo.addEventListener('input', buscar);
      termo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); ativo = Math.min(resultados.length - 1, ativo + 1); desenhar(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(0, ativo - 1); desenhar(); }
        if (e.key === 'Enter') { e.preventDefault(); escolher(ativo); }
      });
      lista.addEventListener('click', (e) => {
        const linha = e.target.closest('[data-i]');
        if (linha) escolher(Number(linha.dataset.i));
      });

      termo.focus();
      caixa._aoEscape = () => { fecharModal(); focarScan(); };
      buscar();
    }
  });
}

// ------------------------------ Carrinho --------------------------------

function alterarQtd(indice, delta) {
  const item = carrinho[indice];
  if (!item) return;
  const nova = item.qtdMilesimal + delta;

  if (nova <= 0) { removerItem(indice); return; }
  if (item.controlaEstoque && nova > item.estoqueMilesimal) {
    mostrarMsg('#scan-msg', `Estoque máximo de "${item.nome}" é ${formatarQtd(item.estoqueMilesimal)}.`, 'warn');
    return;
  }
  item.qtdMilesimal = nova;
  selecionado = indice;
  renderizar();
}

function pedirQuantidade() {
  const item = carrinho[selecionado];
  if (!item) return;
  abrirModal(`
    <h3>Quantidade</h3>
    <div class="sub">${escapar(item.nome)}</div>
    <input id="q-valor" type="text" inputmode="decimal" class="mono" value="${formatarQtd(item.qtdMilesimal)}">
    <div class="btn-row">
      <button class="btn btn-ghost" data-r="0">Voltar</button>
      <button class="btn btn-primary" data-r="1">Aplicar</button>
    </div>
  `, {
    aoMontar(caixa) {
      const campo = caixa.querySelector('#q-valor');
      const aplicar = () => {
        const nova = paraMilesimal(campo.value);
        if (nova === null || nova <= 0) { toast('Quantidade inválida.', 'err'); return; }
        if (item.controlaEstoque && nova > item.estoqueMilesimal) {
          toast(`Estoque máximo é ${formatarQtd(item.estoqueMilesimal)}.`, 'err');
          return;
        }
        item.qtdMilesimal = nova;
        fecharModal();
        renderizar();
        focarScan();
      };
      caixa.querySelector('[data-r="1"]').addEventListener('click', aplicar);
      caixa.querySelector('[data-r="0"]').addEventListener('click', () => { fecharModal(); focarScan(); });
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } });
      campo.focus(); campo.select();
      caixa._aoEscape = () => { fecharModal(); focarScan(); };
    }
  });
}

function removerItem(indice) {
  if (!carrinho[indice]) return;
  carrinho.splice(indice, 1);
  selecionado = Math.max(0, Math.min(selecionado, carrinho.length - 1));
  renderizar();
  focarScan();
}

async function cancelarVenda() {
  if (!carrinho.length) return;
  const ok = await confirmar({
    titulo: 'Cancelar a venda?',
    texto: 'Todos os itens bipados serão descartados. A venda não foi registrada, então nada é perdido no estoque.',
    confirmar: 'Cancelar venda',
    perigo: true
  });
  if (!ok) { focarScan(); return; }
  limpar();
  toast('Venda cancelada.');
}

function limpar() {
  carrinho = [];
  selecionado = 0;
  renderizar();
  api.vendas.rascunhoLimpar().catch(() => {});
  focarScan();
}

// ------------------------------ Finalizar -------------------------------

async function finalizar() {
  if (!carrinho.length) return;

  const totais = calcularTotais(carrinho);
  const pagamento = await escolherPagamento(totais.totalCentavos);
  if (!pagamento) { focarScan(); return; }

  const r = await tentar(() => api.vendas.finalizar({
    itens: carrinho.map((i) => ({
      produtoId: i.produtoId,
      codigoBarras: i.codigoBarras,
      precoUnitCentavos: i.precoUnitCentavos,
      qtdMilesimal: i.qtdMilesimal
    })),
    // Por ora uma forma só por venda, sem split — cobre o pedido de escolher
    // entre dinheiro/pix/débito/crédito sem entrar em pagamento misto ainda.
    pagamentos: [{
      forma: pagamento.forma,
      valorCentavos: pagamento.valorCentavos,
      recebidoCentavos: pagamento.recebidoCentavos
    }],
    totalEsperadoCentavos: totais.totalCentavos
  }));

  if (r === undefined) return;

  limpar();
  const troco = r.trocoCentavos ? ` (troco ${formatarBRL(r.trocoCentavos)})` : '';
  toast(`Venda ${String(r.numero).padStart(6, '0')} registrada — ${formatarBRL(r.totais.totalCentavos)}${troco}`);
  aoFinalizarCallback?.(r);
}

// ------------------------------ Renderização ----------------------------

function renderizar() {
  const corpo = $('#receipt-body');
  $('#receipt-data').textContent = `${formatarDataBR(hojeISO())} · ${agoraHora()}`;

  if (!carrinho.length) {
    corpo.innerHTML = '<div class="receipt-empty">Nenhum item bipado ainda</div>';
  } else {
    const totais = calcularTotais(carrinho);
    corpo.innerHTML = carrinho.map((i, idx) => `
      <div class="rline ${idx === selecionado ? 'selecionada' : ''}">
        <span class="name" title="${escapar(i.nome)}">${escapar(i.nome)}</span>
        <span class="leader"></span>
        <span class="qty-ctrl">
          <button data-acao="menos" data-i="${idx}" title="Diminuir">−</button>
          <span class="mono qty">${formatarQtd(i.qtdMilesimal)}</span>
          <button data-acao="mais" data-i="${idx}" title="Aumentar">+</button>
        </span>
        <span class="price">${formatarBRL(totais.itens[idx].totalItemCentavos)}</span>
        <span class="rm" data-acao="remover" data-i="${idx}" title="Remover">✕</span>
      </div>
    `).join('');
  }

  const total = calcularTotais(carrinho).totalCentavos;
  $('#cart-total').textContent = formatarBRL(total);
  $('#btn-finalizar').disabled = carrinho.length === 0;
  $('#btn-cancelar').disabled = carrinho.length === 0;

  salvarRascunho();
}

// -------------------------- Rascunho de recuperação ---------------------

let timerRascunho = null;
function salvarRascunho() {
  clearTimeout(timerRascunho);
  timerRascunho = setTimeout(() => {
    if (!carrinho.length) return;
    api.vendas.rascunhoSalvar(JSON.stringify({ carrinho, em: new Date().toISOString() })).catch(() => {});
  }, 300);
}

/** Chamado no boot: oferece recuperar um carrinho que ficou pela metade. */
export async function recuperarRascunho() {
  const r = await tentar(() => api.vendas.rascunhoLer(), { aoFalhar: () => {} });
  if (!r?.json) return;

  let dados;
  try { dados = JSON.parse(r.json); } catch { return; }
  if (!dados?.carrinho?.length) return;

  const total = calcularTotais(dados.carrinho).totalCentavos;
  const ok = await confirmar({
    titulo: 'Havia uma venda em andamento',
    texto: `Encontramos ${dados.carrinho.length} item(ns), total ${formatarBRL(total)}, ` +
           `de ${new Date(dados.em).toLocaleString('pt-BR')}. Deseja continuar essa venda?`,
    confirmar: 'Continuar a venda'
  });

  if (ok) {
    carrinho = dados.carrinho;
    selecionado = 0;
    renderizar();
  } else {
    await tentar(() => api.vendas.rascunhoLimpar(), { aoFalhar: () => {} });
  }
  focarScan();
}
