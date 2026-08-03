import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, esconderMsg, toast, confirmar, abrirModal, fecharModal } from '../lib/dom.js';
import { formatarBRL, formatarQtd, paraCentavos, paraMilesimal } from '/compartilhado/formato/moeda.js';

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
  for (const campo of ['#p-codigo', '#p-nome', '#p-preco', '#p-estoque']) {
    $(campo).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    });
  }
}

export async function aoEntrar() {
  const cfg = await tentar(() => api.config.obterTudo(), { aoFalhar: () => {} });
  alertaMinimo = Number(cfg?.estoque_minimo_alerta ?? 5);
  renderizar();
}

// ------------------------------ Formulário -------------------------------

async function salvar() {
  const codigo = $('#p-codigo').value.trim();
  const nome = $('#p-nome').value.trim();
  const precoCentavos = paraCentavos($('#p-preco').value);
  const estoqueMilesimal = paraMilesimal($('#p-estoque').value);

  if (!nome) return mostrarMsg('#p-msg', 'Informe o nome do produto.', 'err');
  if (precoCentavos === null) return mostrarMsg('#p-msg', 'Informe um preço válido (ex.: 5,49).', 'err');

  if (editandoId) {
    const ok = await tentar(
      () => api.produtos.atualizar(editandoId, { nome, precoCentavos }),
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
      () => api.produtos.criar({ nome, precoCentavos, codigos: codigo ? [codigo] : [] }),
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
  $('#p-preco').value = (p.preco_centavos / 100).toFixed(2).replace('.', ',');
  $('#p-estoque').value = formatarQtd(p.estoque_milesimal);
  $('#form-titulo').textContent = `Editando: ${p.nome}`;
  $('#p-acoes-edicao').style.display = 'flex';
  esconderMsg('#p-msg');
  $('#p-nome').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormulario() {
  editandoId = null;
  for (const c of ['#p-codigo', '#p-nome', '#p-preco', '#p-estoque']) $(c).value = '';
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
        <tr><th>Código</th><th>Nome</th><th class="num">Preço</th><th class="num">Estoque</th><th></th></tr>
      </thead>
      <tbody>
        ${lista.map((p) => `
          <tr class="${p.estoque_milesimal === 0 ? 'zero' : (p.estoque_milesimal <= minimo ? 'low' : '')}">
            <td class="mono">${escapar(p.codigo ?? '—')}</td>
            <td>${escapar(p.nome)}</td>
            <td class="num">${formatarBRL(p.preco_centavos)}</td>
            <td class="num stockcell">${p.controla_estoque ? formatarQtd(p.estoque_milesimal) : '—'}</td>
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
