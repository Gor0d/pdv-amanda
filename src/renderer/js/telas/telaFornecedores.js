import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, mostrarMsg, esconderMsg, toast, confirmar } from '../lib/dom.js';

let editandoId = null;

const CAMPOS = ['#f-nome', '#f-cpf-cnpj', '#f-telefone', '#f-email', '#f-endereco', '#f-observacoes'];

export function montar() {
  const secao = $('#tab-fornecedores');

  aoClicar(secao, '[data-acao]', (el) => {
    const acao = el.dataset.acao;
    const id = Number(el.dataset.id);
    if (acao === 'salvar-fornecedor') salvar();
    if (acao === 'cancelar-edicao-fornecedor') limparFormulario();
    if (acao === 'editar-fornecedor') editar(id);
    if (acao === 'inativar-fornecedor') inativar(id, el.dataset.nome);
  });

  $('#f-busca').addEventListener('input', renderizar);

  for (const campo of CAMPOS) {
    $(campo).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    });
  }
}

export function aoEntrar() {
  renderizar();
}

async function salvar() {
  const nome = $('#f-nome').value.trim();
  if (!nome) return mostrarMsg('#f-msg', 'Informe o nome do fornecedor.', 'err');

  const dados = {
    nome,
    cpfCnpj: $('#f-cpf-cnpj').value.trim(),
    telefone: $('#f-telefone').value.trim(),
    email: $('#f-email').value.trim(),
    endereco: $('#f-endereco').value.trim(),
    observacoes: $('#f-observacoes').value.trim()
  };

  if (editandoId) {
    const ok = await tentar(
      () => api.fornecedores.atualizar(editandoId, dados),
      { aoFalhar: (e) => mostrarMsg('#f-msg', e.message, 'err') }
    );
    if (ok === undefined) return;
    toast('Fornecedor atualizado.');
  } else {
    const id = await tentar(
      () => api.fornecedores.criar(dados),
      { aoFalhar: (e) => mostrarMsg('#f-msg', e.message, 'err') }
    );
    if (id === undefined) return;
    toast('Fornecedor cadastrado.');
  }

  limparFormulario();
  renderizar();
  $('#f-nome').focus();
}

async function editar(id) {
  const f = await tentar(() => api.fornecedores.porId(id));
  if (!f) return;

  editandoId = id;
  $('#f-nome').value = f.nome;
  $('#f-cpf-cnpj').value = f.cpf_cnpj ?? '';
  $('#f-telefone').value = f.telefone ?? '';
  $('#f-email').value = f.email ?? '';
  $('#f-endereco').value = f.endereco ?? '';
  $('#f-observacoes').value = f.observacoes ?? '';
  $('#f-form-titulo').textContent = `Editando: ${f.nome}`;
  $('#f-acoes-edicao').style.display = 'flex';
  esconderMsg('#f-msg');
  $('#f-nome').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormulario() {
  editandoId = null;
  for (const c of CAMPOS) $(c).value = '';
  $('#f-form-titulo').textContent = 'Cadastrar fornecedor';
  $('#f-acoes-edicao').style.display = 'none';
  esconderMsg('#f-msg');
}

async function inativar(id, nome) {
  const ok = await confirmar({
    titulo: `Tirar "${nome}" da lista?`,
    texto: 'O fornecedor deixa de aparecer nas buscas, mas nada é apagado.',
    confirmar: 'Tirar da lista',
    perigo: true
  });
  if (!ok) return;
  await tentar(() => api.fornecedores.inativar(id));
  toast('Fornecedor retirado da lista.');
  renderizar();
}

async function renderizar() {
  const termo = $('#f-busca').value;
  const lista = await tentar(() => api.fornecedores.listar({ termo, apenasAtivos: true, limite: 300 }));
  const el = $('#fornecedores-tabela');
  if (lista === undefined) return;

  if (!lista.length) {
    el.innerHTML = termo
      ? '<div class="empty-state">Nenhum fornecedor encontrado para essa busca.</div>'
      : '<div class="empty-state">Nenhum fornecedor cadastrado ainda. Use o formulário acima para começar.</div>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>E-mail</th><th></th></tr>
      </thead>
      <tbody>
        ${lista.map((f) => `
          <tr>
            <td>${escapar(f.nome)}</td>
            <td class="mono">${escapar(f.cpf_cnpj ?? '—')}</td>
            <td class="mono">${escapar(f.telefone ?? '—')}</td>
            <td>${escapar(f.email ?? '—')}</td>
            <td class="acoes-linha">
              <button class="icon-btn" data-acao="editar-fornecedor" data-id="${f.id}" title="Editar">✎</button>
              <button class="icon-btn del" data-acao="inativar-fornecedor" data-id="${f.id}" data-nome="${escapar(f.nome)}" title="Tirar da lista">🗑</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
