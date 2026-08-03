import { api, tentar } from '../api.js';
import { $, escapar, aoClicar, toast, confirmar, abrirModal, fecharModal } from '../lib/dom.js';
import { formatarBRL, formatarQtd } from '/compartilhado/formato/moeda.js';
import { formatarDataBR, hojeISO } from '/compartilhado/formato/data.js';

const NOME_FORMA = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', fiado: 'Fiado'
};

export function montar() {
  const secao = $('#tab-relatorios');
  $('#rel-data').addEventListener('change', renderizar);

  aoClicar(secao, '[data-acao]', (el) => {
    if (el.dataset.acao === 'chip') { $('#rel-data').value = el.dataset.data; renderizar(); }
    if (el.dataset.acao === 'cancelar-venda') cancelarVenda(Number(el.dataset.id), el.dataset.numero);
    if (el.dataset.acao === 'ver-venda') verVenda(Number(el.dataset.id));
  });
}

export function aoEntrar() {
  if (!$('#rel-data').value) $('#rel-data').value = hojeISO();
  renderizar();
}

export async function renderizar() {
  const data = $('#rel-data').value || hojeISO();

  const [relatorio, vendas, estoque, dias] = await Promise.all([
    tentar(() => api.relatorios.doDia(data)),
    tentar(() => api.vendas.listarDoDia(data)),
    tentar(() => api.relatorios.estoqueAtual()),
    tentar(() => api.relatorios.diasComVenda(10))
  ]);
  if (!relatorio) return;

  const { resumo, produtos, formas } = relatorio;
  $('#rel-total').textContent = formatarBRL(resumo.total_centavos);
  $('#rel-itens').textContent = formatarQtd(resumo.itens_milesimal);
  $('#rel-vendas').textContent = resumo.qtd_vendas;

  desenharChips(dias || [], data);
  desenharProdutos(produtos, formas, resumo);
  desenharVendas(vendas || []);
  desenharEstoque(estoque || []);
}

function desenharChips(dias, dataAtual) {
  const el = $('#rel-chips');
  if (!dias.length) { el.innerHTML = ''; return; }
  el.innerHTML = dias.map((d) => `
    <span class="chip ${d.data === dataAtual ? 'ativo' : ''}" data-acao="chip" data-data="${escapar(d.data)}">
      ${formatarDataBR(d.data)} · ${formatarBRL(d.total_centavos)}
    </span>
  `).join('');
}

function desenharProdutos(produtos, formas, resumo) {
  const el = $('#rel-produtos');
  if (!produtos.length) {
    el.innerHTML = '<div class="empty-state">Nenhuma venda registrada nesse dia.</div>';
    return;
  }

  const porForma = formas.length
    ? `<div class="bloco-secundario">
         ${formas.map((f) => `
           <div class="linha-info">
             <span class="rotulo">${NOME_FORMA[f.forma] ?? escapar(f.forma)}</span>
             <span class="valor">${formatarBRL(f.total_centavos)}</span>
           </div>`).join('')}
       </div>`
    : '';

  const canceladas = resumo.qtd_canceladas
    ? `<div class="aviso-cancelado">
         ${resumo.qtd_canceladas} venda(s) cancelada(s) no dia, somando ${formatarBRL(resumo.cancelado_centavos)}.
       </div>`
    : '';

  el.innerHTML = `
    <table>
      <thead><tr><th>Produto</th><th class="num">Qtd. vendida</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${produtos.map((p) => `
          <tr>
            <td>${escapar(p.descricao)}</td>
            <td class="num">${formatarQtd(p.qtd_milesimal)}</td>
            <td class="num">${formatarBRL(p.total_centavos)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${porForma}
    ${canceladas}
  `;
}

function desenharVendas(vendas) {
  const el = $('#rel-lista-vendas');
  if (!vendas.length) {
    el.innerHTML = '<div class="empty-state">Nenhuma venda nesse dia.</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead>
        <tr><th>Nº</th><th>Hora</th><th class="num">Itens</th><th class="num">Total</th><th>Situação</th><th></th></tr>
      </thead>
      <tbody>
        ${vendas.map((v) => `
          <tr class="${v.status === 'cancelada' ? 'inativo' : ''}">
            <td class="mono">${String(v.numero).padStart(6, '0')}</td>
            <td class="mono">${escapar(v.hora)}</td>
            <td class="num">${v.qtd_itens}</td>
            <td class="num">${formatarBRL(v.total_centavos)}</td>
            <td>${v.status === 'cancelada'
                  ? '<span class="txt-perigo">Cancelada</span>'
                  : '<span class="txt-ok">Finalizada</span>'}</td>
            <td class="acoes-linha">
              <button class="icon-btn" data-acao="ver-venda" data-id="${v.id}" title="Ver detalhes">👁</button>
              ${v.status === 'finalizada'
                ? `<button class="icon-btn del" data-acao="cancelar-venda" data-id="${v.id}"
                           data-numero="${v.numero}" title="Cancelar venda">✕</button>`
                : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function desenharEstoque(estoque) {
  const el = $('#rel-estoque');
  if (!estoque.length) {
    el.innerHTML = '<div class="empty-state">Nenhum produto cadastrado.</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Produto</th><th class="num">Estoque restante</th></tr></thead>
      <tbody>
        ${estoque.map((p) => `
          <tr class="${p.estoque_milesimal === 0 ? 'zero' : (p.estoque_milesimal <= p.estoque_minimo_milesimal ? 'low' : '')}">
            <td class="mono">${escapar(p.codigo ?? '—')}</td>
            <td>${escapar(p.nome)}</td>
            <td class="num stockcell">${formatarQtd(p.estoque_milesimal)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

// ------------------------------ Ações ------------------------------------

async function verVenda(id) {
  const v = await tentar(() => api.vendas.porId(id));
  if (!v) return;

  abrirModal(`
    <h3>Venda ${String(v.numero).padStart(6, '0')}</h3>
    <div class="sub">${formatarDataBR(v.data)} às ${escapar(v.hora)}
      ${v.status === 'cancelada' ? ' · <span class="txt-perigo">CANCELADA</span>' : ''}</div>
    <div class="receipt sem-moldura">
      ${v.itens.map((i) => `
        <div class="rline">
          <span class="name">${escapar(i.descricao)}</span>
          <span class="leader"></span>
          <span class="mono qty">${formatarQtd(i.qtd_milesimal)}</span>
          <span class="price">${formatarBRL(i.total_item_centavos)}</span>
        </div>`).join('')}
      <div class="rtotal">
        <span class="label">Total</span>
        <span class="amount total-modal">${formatarBRL(v.total_centavos)}</span>
      </div>
    </div>
    ${v.pagamentos.map((p) => `
      <div class="linha-info">
        <span class="rotulo">${NOME_FORMA[p.forma] ?? escapar(p.forma)}</span>
        <span class="valor">${formatarBRL(p.valor_centavos)}</span>
      </div>`).join('')}
    ${v.status === 'cancelada' ? `
      <div class="linha-info"><span class="rotulo">Motivo do cancelamento</span>
        <span class="valor">${escapar(v.cancelada_motivo ?? '')}</span></div>` : ''}
    <div class="btn-row"><button class="btn btn-ghost" data-r="0">Fechar</button></div>
  `, {
    aoMontar(caixa) {
      caixa.querySelector('[data-r="0"]').addEventListener('click', fecharModal);
      caixa.querySelector('[data-r="0"]').focus();
    }
  });
}

async function cancelarVenda(id, numero) {
  const ok = await confirmar({
    titulo: `Cancelar a venda ${String(numero).padStart(6, '0')}?`,
    texto: 'O estoque dos itens volta para a prateleira e a venda sai do total do dia. ' +
           'A venda não é apagada: fica registrada como cancelada.',
    confirmar: 'Sim, cancelar',
    perigo: true
  });
  if (!ok) return;

  const motivo = await pedirMotivo();
  if (!motivo) return;

  const r = await tentar(() => api.vendas.cancelar({ vendaId: id, motivo }));
  if (r === undefined) return;

  toast(`Venda ${String(numero).padStart(6, '0')} cancelada. Estoque devolvido.`);
  renderizar();
}

function pedirMotivo() {
  return new Promise((resolve) => {
    abrirModal(`
      <h3>Motivo do cancelamento</h3>
      <div class="sub">Fica registrado para consulta depois. É obrigatório.</div>
      <input id="mc-motivo" type="text" placeholder="Ex.: cliente desistiu, item errado">
      <div class="btn-row">
        <button class="btn btn-ghost" data-r="0">Voltar</button>
        <button class="btn btn-perigo" data-r="1">Cancelar a venda</button>
      </div>
    `, {
      aoMontar(caixa) {
        const campo = caixa.querySelector('#mc-motivo');
        const confirmarMotivo = () => {
          const v = campo.value.trim();
          if (!v) { toast('Informe o motivo.', 'err'); return; }
          fecharModal();
          resolve(v);
        };
        caixa.querySelector('[data-r="1"]').addEventListener('click', confirmarMotivo);
        caixa.querySelector('[data-r="0"]').addEventListener('click', () => { fecharModal(); resolve(null); });
        campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarMotivo(); } });
        campo.focus();
        caixa._aoEscape = () => { fecharModal(); resolve(null); };
      }
    });
  });
}
