import { toast } from './lib/dom.js';

/**
 * Envelopa window.pdv (exposto pelo preload).
 *
 * Todo handler do main devolve {ok, dados} | {ok:false, codigo, mensagem}.
 * Aqui isso vira: sucesso devolve os dados direto; falha lança ErroApi com o
 * código, para a tela decidir o que oferecer. Assim nenhuma tela precisa
 * inspecionar `.ok` a cada chamada.
 */
export class ErroApi extends Error {
  constructor(codigo, mensagem, detalhes) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

function envolver(objeto, prefixo = '') {
  const saida = {};
  for (const [nome, fn] of Object.entries(objeto)) {
    if (typeof fn === 'function') {
      saida[nome] = async (...args) => {
        const r = await fn(...args);
        if (!r?.ok) throw new ErroApi(r?.codigo ?? 'ERRO_INTERNO', r?.mensagem ?? 'Falha desconhecida.', r?.detalhes);
        return r.dados;
      };
    } else {
      saida[nome] = envolver(fn, `${prefixo}${nome}.`);
    }
  }
  return saida;
}

export const api = envolver(window.pdv);

/**
 * Executa uma ação tratando o erro de negócio como mensagem para o operador.
 * Erro inesperado também vira toast: no balcão, um botão que não faz nada é
 * pior que uma mensagem feia.
 */
export async function tentar(fn, { aoFalhar } = {}) {
  try {
    return await fn();
  } catch (e) {
    if (aoFalhar) aoFalhar(e);
    else toast(e.message || 'Não foi possível concluir a operação.', 'err');
    return undefined;
  }
}
