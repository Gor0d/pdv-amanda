import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, esconderMsg, toast, confirmar, abrirModal, fecharModal } from '../lib/dom.js';
import { formatarBRL, formatarQtd, paraCentavos, paraMilesimal } from '/compartilhado/formato/moeda.js';
import { formatarDataBR, hojeISO, somarDiasISO } from '/compartilhado/formato/data.js';

let editandoId = null;
let alertaMinimo = 5;

export function montar() {
  const secao = $('#tab-estoque');

  aoClicar(secao, '[data-acao]', (el) => {
    const acao = el.dataset.acao;
    const id = Number(el.dataset.id);
    if (acao === 'salvar-produto') salvar();
    if (acao === 'cancelar-edicao') limparFormulario();
    if (acao === 'editar') editar(id);
    if (acao === 'inativar') inativar(id, el.dataset.nome);
    if (acao === 'entrada') abrirEntrada(id, el.dataset.nome);
  });

  $('#p-busca').addEventListener('input', renderizar);

  // Enter em qualquer campo do formulário salva — o cadastro é feito no
  // teclado, entre uma venda e outra.
  for (const campo of ['#p-codigo', '#p-nome', '#p-custo', '#p-margem', '#p-lucro', '#p-preco', '#p-estoque']) {
    $(campo).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    });
  }

  instalarCalculoPreco();
}

// --------------------------- Calculadora de preço -------------------------
//
// Preço de compra, Margem (%), Lucro (R$) e Preço de venda formam um
// triângulo: fixado o custo, qualquer um dos outros três recalcula os outros
// dois. Markup sobre o custo (lucro = custo × margem/100), igual ao sistema
// que a loja usava antes — não é margem sobre o preço de venda.
//
// Cada handler ESCREVE nos outros campos via .value (nunca dispara 'input'
// neles), então não há risco de loop entre os três.

function paraPercentual(texto) {
  const limpo = String(texto ?? '').trim().replace(',', '.');
  if (limpo === '') return null;
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

function preencherCentavos(input, centavos) {
  input.value = (centavos / 100).toFixed(2).replace('.', ',');
}

function preencherPercentual(input, pct) {
  input.value = pct.toFixed(2).replace('.', ',');
}

function instalarCalculoPreco() {
  const custo = $('#p-custo');
  const margem = $('#p-margem');
  const lucro = $('#p-lucro');
  const preco = $('#p-preco');

  const custoAtual = () => paraCentavos(custo.value) ?? 0;

  const aPartirDaMargem = () => {
    const pct = paraPercentual(margem.value);
    if (pct === null) return;
    const l = Math.round((custoAtual() * pct) / 100);
    preencherCentavos(lucro, l);
    preencherCentavos(preco, custoAtual() + l);
  };

  const aPartirDoLucro = () => {
    const l = paraCentavos(lucro.value);
    if (l === null) return;
    preencherCentavos(preco, custoAtual() + l);
    const c = custoAtual();
    if (c > 0) preencherPercentual(margem, (l / c) * 100);
  };

  const aPartirDoPreco = () => {
    const p = paraCentavos(preco.value);
    if (p === null) return;
    const l = p - custoAtual();
    preencherCentavos(lucro, l);
    const c = custoAtual();
    if (c > 0) preencherPercentual(margem, (l / c) * 100);
  };

  custo.addEventListener('input', () => {
    // Custo mudou: se já existe uma margem definida, ela manda; senão
    // recalcula a partir do preço de venda já digitado.
    if (margem.value.trim()) aPartirDaMargem();
    else if (preco.value.trim()) aPartirDoPreco();
  });
  margem.addEventListener('input', aPartirDaMargem);
  lucro.addEventListener('input', aPartirDoLucro);
  preco.addEventListener('input', aPartirDoPreco);
}

export async function aoEntrar() {
  const cfg = await tentar(() => api.config.obterTudo(), { aoFalhar: () => {} });
  alertaMinimo = Number(cfg?.estoque_minimo_alerta ?? 5);
  await carregarFornecedoresSelect();
  renderizar();
}

/** Recarrega as opções do select de fornecedor — chamado sempre que a aba abre,
 * pra listar fornecedores cadastrados depois da última vez. */
async function carregarFornecedoresSelect() {
  const select = $('#p-fornecedor');
  const selecionado = select.value;
  const lista = (await tentar(() => api.fornecedores.listar({}), { aoFalhar: () => {} })) || [];
  select.innerHTML = '<option value="">— nenhum —</option>' +
    lista.map((f) => `<option value="${f.id}">${escapar(f.nome)}</option>`).join('');
  select.value = selecionado;
}

// ------------------------------ Formulário -------------------------------

async function salvar() {
  const codigo = $('#p-codigo').value.trim();
  const nome = $('#p-nome').value.trim();
  const precoCentavos = paraCentavos($('#p-preco').value);
  const estoqueMilesimal = paraMilesimal($('#p-estoque').value);
  const custoTexto = $('#p-custo').value.trim();
  const custoCentavos = custoTexto ? paraCentavos(custoTexto) : null;
  const validade = $('#p-validade').value || null;
  const fornecedorId = $('#p-fornecedor').value ? Number($('#p-fornecedor').value) : null;

  if (!nome) return mostrarMsg('#p-msg', 'Informe o nome do produto.', 'err');
  if (precoCentavos === null) return mostrarMsg('#p-msg', 'Informe um preço válido (ex.: 5,49).', 'err');
  if (custoTexto && custoCentavos === null) return mostrarMsg('#p-msg', 'Informe um custo válido (ex.: 3,20).', 'err');

  if (editandoId) {
    const ok = await tentar(
      () => api.produtos.atualizar(editandoId, { nome, precoCentavos, custoCentavos, validade, fornecedorId }),
      { aoFalhar: (e) => mostrarMsg('#p-msg', e.message, 'err') }
    );
    if (ok === undefined) return;

    // Estoque não é campo do cadastro: mexer nele é lançamento no ledger, com
    // motivo, para o histórico continuar batendo.
    if (estoqueMilesimal !== null) {
      const atual = await tentar(() => api.produtos.porId(editandoId));
      if (atual && atual.estoque_milesimal !== estoqueMilesimal) {
        await tentar(() => api.estoque.ajustar({
          produtoId: editandoId,
          novoSaldoMilesimal: estoqueMilesimal,
          motivo: 'Ajuste manual pelo cadastro'
        }));
      }
    }

    // Código novo digitado num produto que ainda não tinha: acrescenta.
    if (codigo) {
      const codigos = (await tentar(() => api.produtos.codigos(editandoId))) || [];
      if (!codigos.some((c) => c.codigo === codigo)) {
        await tentar(() => api.produtos.adicionarCodigo(editandoId, codigo),
          { aoFalhar: (e) => toast(e.message, 'err') });
      }
    }

    toast('Produto atualizado.');
  } else {
    const id = await tentar(
      () => api.produtos.criar({
        nome, precoCentavos, custoCentavos, validade, fornecedorId, codigos: codigo ? [codigo] : []
      }),
      { aoFalhar: (e) => mostrarMsg('#p-msg', e.message, 'err') }
    );
    if (id === undefined) return;

    if (estoqueMilesimal) {
      await tentar(() => api.estoque.entrada({
        produtoId: id, qtdMilesimal: estoqueMilesimal, motivo: 'Estoque inicial do cadastro'
      }));
    }
    toast('Produto cadastrado.');
  }

  limparFormulario();
  renderizar();
  $('#p-codigo').focus();
}

async function editar(id) {
  const p = await tentar(() => api.produtos.porId(id));
  if (!p) return;
  const codigos = (await tentar(() => api.produtos.codigos(id))) || [];

  editandoId = id;
  $('#p-codigo').value = codigos[0]?.codigo ?? '';
  $('#p-nome').value = p.nome;
  $('#p-custo').value = p.custo_centavos != null ? (p.custo_centavos / 100).toFixed(2).replace('.', ',') : '';
  $('#p-preco').value = (p.preco_centavos / 100).toFixed(2).replace('.', ',');
  if (p.custo_centavos != null && p.custo_centavos > 0) {
    const lucroCentavos = p.preco_centavos - p.custo_centavos;
    $('#p-lucro').value = (lucroCentavos / 100).toFixed(2).replace('.', ',');
    $('#p-margem').value = ((lucroCentavos / p.custo_centavos) * 100).toFixed(2).replace('.', ',');
  } else {
    $('#p-lucro').value = '';
    $('#p-margem').value = '';
  }
  $('#p-estoque').value = formatarQtd(p.estoque_milesimal);
  $('#p-validade').value = p.validade ?? '';
  $('#p-fornecedor').value = p.fornecedor_id ?? '';
  $('#form-titulo').textContent = `Editando: ${p.nome}`;
  $('#p-acoes-edicao').style.display = 'flex';
  esconderMsg('#p-msg');
  $('#p-nome').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormulario() {
  editandoId = null;
  for (const c of ['#p-codigo', '#p-nome', '#p-custo', '#p-margem', '#p-lucro', '#p-preco', '#p-estoque', '#p-validade']) {
    $(c).value = '';
  }
  $('#p-fornecedor').value = '';
  $('#form-titulo').textContent = 'Cadastrar produto';
  $('#p-acoes-edicao').style.display = 'none';
  esconderMsg('#p-msg');
}

async function inativar(id, nome) {
  const ok = await confirmar({
    titulo: `Tirar "${nome}" da lista?`,
    texto: 'O produto deixa de aparecer nas buscas, mas continua no histórico das vendas já feitas. Nada é apagado.',
    confirmar: 'Tirar da lista',
    perigo: true
  });
  if (!ok) return;
  await tentar(() => api.produtos.inativar(id));
  toast('Produto retirado da lista.');
  renderizar();
}

function abrirEntrada(id, nome) {
  abrirModal(`
    <h3>Entrada de estoque</h3>
    <div class="sub">${escapar(nome)}</div>
    <div class="grid-campos">
      <div><label for="e-qtd">Quantidade que chegou</label>
           <input id="e-qtd" type="text" inputmode="decimal" class="mono" placeholder="0"></div>
      <div><label for="e-motivo">Motivo / nota</label>
           <input id="e-motivo" type="text" placeholder="Ex.: compra do fornecedor"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" data-r="0">Voltar</button>
      <button class="btn btn-primary" data-r="1">Lançar entrada</button>
    </div>
  `, {
    aoMontar(caixa) {
      const qtd = caixa.querySelector('#e-qtd');
      const lancar = async () => {
        const qtdMilesimal = paraMilesimal(qtd.value);
        if (!qtdMilesimal || qtdMilesimal <= 0) { toast('Informe uma quantidade maior que zero.', 'err'); return; }
        const r = await tentar(() => api.estoque.entrada({
          produtoId: id,
          qtdMilesimal,
          motivo: caixa.querySelector('#e-motivo').value.trim() || 'Entrada de estoque'
        }));
        if (r === undefined) return;
        fecharModal();
        toast('Entrada lançada.');
        renderizar();
      };
      caixa.querySelector('[data-r="1"]').addEventListener('click', lancar);
      caixa.querySelector('[data-r="0"]').addEventListener('click', fecharModal);
      qtd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lancar(); } });
      qtd.focus();
    }
  });
}

/** Classe de destaque pra validade: vencido, perto de vencer (10 dias) ou normal. */
function classeValidade(validade) {
  if (!validade) return '';
  const limite = somarDiasISO(hojeISO(), 10);
  if (validade < hojeISO()) return 'venc-vencido';
  if (validade <= limite) return 'venc-proximo';
  return '';
}

/** Markup sobre o custo: (preço - custo) / custo. Mesma conta do formulário de cadastro. */
function calcularMargem(custoCentavos, precoCentavos) {
  if (custoCentavos == null || !custoCentavos) return '—';
  const margem = ((precoCentavos - custoCentavos) / custoCentavos) * 100;
  return `${margem.toFixed(1).replace('.', ',')}%`;
}

// ------------------------------- Tabela ----------------------------------

async function renderizar() {
  const termo = $('#p-busca').value;
  const lista = await tentar(() => api.produtos.listar({ termo, apenasAtivos: true, limite: 300 }));
  const el = $('#produtos-tabela');
  if (lista === undefined) return;

  if (!lista.length) {
    el.innerHTML = termo
      ? '<div class="empty-state">Nenhum produto encontrado para essa busca.</div>'
      : '<div class="empty-state">Nenhum produto cadastrado ainda. Use o formulário acima para começar.</div>';
    return;
  }

  const minimo = alertaMinimo * 1000;
  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Código</th><th>Nome</th><th class="num">Custo</th><th class="num">Preço</th>
          <th class="num">Margem</th><th class="num">Estoque</th><th>Validade</th><th>Fornecedor</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((p) => `
          <tr class="${p.estoque_milesimal === 0 ? 'zero' : (p.estoque_milesimal <= minimo ? 'low' : '')}">
            <td class="mono">${escapar(p.codigo ?? '—')}</td>
            <td>${escapar(p.nome)}</td>
            <td class="num">${p.custo_centavos != null ? formatarBRL(p.custo_centavos) : '—'}</td>
            <td class="num">${formatarBRL(p.preco_centavos)}</td>
            <td class="num">${calcularMargem(p.custo_centavos, p.preco_centavos)}</td>
            <td class="num stockcell">${p.controla_estoque ? formatarQtd(p.estoque_milesimal) : '—'}</td>
            <td class="${classeValidade(p.validade)}">${p.validade ? formatarDataBR(p.validade) : '—'}</td>
            <td>${escapar(p.fornecedor_nome ?? '—')}</td>
            <td class="acoes-linha">
              <button class="icon-btn" data-acao="entrada" data-id="${p.id}" data-nome="${escapar(p.nome)}" title="Entrada de estoque">↓</button>
              <button class="icon-btn" data-acao="editar" data-id="${p.id}" title="Editar">✎</button>
              <button class="icon-btn del" data-acao="inativar" data-id="${p.id}" data-nome="${escapar(p.nome)}" title="Tirar da lista">🗑</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export { renderizar };
