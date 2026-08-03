import { createHash, randomUUID } from 'node:crypto';
import { obterBanco } from '../db/conexao.js';
import * as vendasRepo from '../repos/vendasRepo.js';
import { agoraTimestamp, hojeISO } from '../../compartilhado/formato/data.js';
import { paraCentavos } from '../../compartilhado/formato/moeda.js';
import { ErroNegocio, CODIGOS } from '../util/erros.js';

/**
 * Importa o JSON exportado pelo protótipo:
 *   { versao, exportadoEm, produtos: [{code,name,price,stock}],
 *     vendasLog: [{saleId,date,time,code,name,price,qty}] }
 *
 * Tudo em uma transação, e idempotente por hash do arquivo — clicar duas vezes
 * não duplica nada.
 */
export function importar(conteudoJson, { arquivo = null, log = console } = {}) {
  const db = obterBanco();
  const hash = createHash('sha256').update(conteudoJson).digest('hex');

  const jaImportado = db.prepare('SELECT relatorio_json FROM importacoes WHERE hash = ?').get(hash);
  if (jaImportado) {
    return { ...JSON.parse(jaImportado.relatorio_json), jaImportado: true };
  }

  let dados;
  try {
    dados = JSON.parse(conteudoJson);
  } catch {
    throw new ErroNegocio(CODIGOS.DADOS_INVALIDOS, 'O arquivo escolhido não é um JSON válido.');
  }
  if (!Array.isArray(dados?.produtos)) {
    throw new ErroNegocio(
      CODIGOS.DADOS_INVALIDOS,
      'O arquivo não parece ser um export do sistema anterior (não tem a lista de produtos).'
    );
  }

  return db.transaction(() => {
    const avisos = [];
    const ts = agoraTimestamp();
    const hoje = hojeISO();
    const porCodigo = new Map(); // code do protótipo -> produto_id

    // ---------------- 1. Produtos ----------------
    let produtosCriados = 0;
    let produtosDuplicados = 0;

    for (const p of dados.produtos) {
      const code = String(p.code ?? '').trim();
      const nome = String(p.name ?? '').trim() || '(sem nome)';
      const precoCentavos = paraCentavos(p.price) ?? 0;
      const estoqueMilesimal = Math.round(Number(p.stock || 0) * 1000);

      if (!code) {
        avisos.push(`Produto "${nome}" não tinha código e foi importado sem código de barras.`);
      }

      if (code && porCodigo.has(code)) {
        // O protótipo permitia duplicata em alguns caminhos; somamos o estoque.
        produtosDuplicados++;
        const idExistente = porCodigo.get(code);
        lancarEstoqueInicial(db, idExistente, estoqueMilesimal, ts, hoje, 'Duplicata somada na importação');
        avisos.push(`Código ${code} aparecia mais de uma vez; os estoques foram somados.`);
        continue;
      }

      const produtoId = db
        .prepare(
          `INSERT INTO produtos (nome, unidade, preco_centavos, estoque_milesimal,
                                 estoque_minimo_milesimal, controla_estoque, ativo, origem,
                                 criado_em, atualizado_em)
           VALUES (?, 'UN', ?, 0, 5000, 1, 1, 'importado', ?, ?)`
        )
        .run(nome, precoCentavos, ts, ts).lastInsertRowid;

      if (code) {
        db.prepare(
          `INSERT INTO produto_codigos (produto_id, codigo, tipo, fator_milesimal, principal, criado_em)
           VALUES (?, ?, 'EAN', 1000, 1, ?)`
        ).run(produtoId, code, ts);
        porCodigo.set(code, produtoId);
      }

      lancarEstoqueInicial(db, produtoId, estoqueMilesimal, ts, hoje,
        'Saldo inicial importado do sistema anterior');
      produtosCriados++;
    }

    // ---------------- 2. Vendas ----------------
    // O `stock` exportado já é o saldo DEPOIS de todas as vendas. Por isso as
    // vendas importadas NÃO geram movimento de estoque: se gerassem, todo saldo
    // ficaria negativo. O 'inventario' acima é o ponto de partida; o histórico
    // anterior entra só como registro de faturamento.
    const grupos = new Map();
    for (const linha of dados.vendasLog || []) {
      const id = String(linha.saleId ?? '');
      if (!grupos.has(id)) grupos.set(id, []);
      grupos.get(id).push(linha);
    }

    let vendasCriadas = 0;
    let itensSemProduto = 0;

    // Ordenar por data/hora para a numeração sair cronológica.
    const ordenados = [...grupos.entries()].sort((a, b) => {
      const ka = `${a[1][0]?.date ?? ''} ${a[1][0]?.time ?? ''}`;
      const kb = `${b[1][0]?.date ?? ''} ${b[1][0]?.time ?? ''}`;
      return ka.localeCompare(kb);
    });

    for (const [, linhas] of ordenados) {
      const primeira = linhas[0];
      const itens = linhas.map((l, i) => {
        const code = String(l.code ?? '').trim();
        let produtoId = code ? porCodigo.get(code) : undefined;

        if (produtoId === undefined) {
          // O produto foi excluído (ou teve o código trocado) no protótipo.
          // Criamos um registro histórico inativo para o item não ficar órfão.
          produtoId = criarProdutoHistorico(db, l, ts);
          if (code) porCodigo.set(code, produtoId);
          itensSemProduto++;
          avisos.push(`"${l.name}" (código ${code || 'sem código'}) não estava mais no cadastro; ` +
                      'foi recriado como produto histórico inativo.');
        }

        const precoCentavos = paraCentavos(l.price) ?? 0;
        const qtdMilesimal = Math.round(Number(l.qty || 0) * 1000);
        return {
          seq: i + 1,
          produtoId,
          codigo: code || null,
          descricao: String(l.name ?? '(sem nome)'),
          precoCentavos,
          qtdMilesimal,
          totalCentavos: Math.round((precoCentavos * qtdMilesimal) / 1000)
        };
      });

      const total = itens.reduce((s, i) => s + i.totalCentavos, 0);
      const numero = vendasRepo.proximoNumero();
      const data = String(primeira?.date ?? hoje).slice(0, 10);
      const hora = String(primeira?.time ?? '00:00').slice(0, 5);

      const vendaId = db
        .prepare(
          `INSERT INTO vendas (numero, uuid, sessao_id, status, subtotal_centavos,
                               desconto_itens_centavos, desconto_venda_centavos,
                               acrescimo_centavos, total_centavos, troco_centavos,
                               observacoes, criado_em, data, hora, origem)
           VALUES (?, ?, NULL, 'finalizada', ?, 0, 0, 0, ?, 0, ?, ?, ?, ?, 'importado')`
        )
        .run(
          numero, randomUUID(), total, total,
          'Importada do sistema anterior. Forma de pagamento não era registrada lá.',
          `${data} ${hora}:00`, data, hora
        ).lastInsertRowid;

      for (const it of itens) {
        db.prepare(
          `INSERT INTO venda_itens (venda_id, seq, produto_id, codigo_barras, descricao, unidade,
                                    preco_unit_centavos, qtd_milesimal, desconto_item_centavos,
                                    rateio_desconto_venda_centavos, total_item_centavos)
           VALUES (?, ?, ?, ?, ?, 'UN', ?, ?, 0, 0, ?)`
        ).run(vendaId, it.seq, it.produtoId, it.codigo, it.descricao,
              it.precoCentavos, it.qtdMilesimal, it.totalCentavos);
      }

      // Suposição registrada: o protótipo não guardava forma de pagamento.
      db.prepare(
        `INSERT INTO pagamentos (venda_id, forma, valor_centavos, valor_recebido_centavos,
                                 troco_centavos, criado_em)
         VALUES (?, 'dinheiro', ?, ?, 0, ?)`
      ).run(vendaId, total, total, `${data} ${hora}:00`);

      vendasCriadas++;
    }

    const relatorio = {
      produtosCriados,
      produtosDuplicados,
      vendasCriadas,
      itensSemProduto,
      avisos: avisos.slice(0, 50),
      totalAvisos: avisos.length
    };

    db.prepare(
      'INSERT INTO importacoes (hash, arquivo, relatorio_json, criado_em) VALUES (?, ?, ?, ?)'
    ).run(hash, arquivo, JSON.stringify(relatorio), ts);

    log.info?.(
      `Importação: ${produtosCriados} produtos, ${vendasCriadas} vendas, ${avisos.length} avisos`
    );
    return { ...relatorio, jaImportado: false };
  })();
}

function lancarEstoqueInicial(db, produtoId, qtdMilesimal, ts, data, motivo) {
  if (!qtdMilesimal) return;
  const atual = db.prepare('SELECT estoque_milesimal FROM produtos WHERE id = ?').get(produtoId);
  const saldo = atual.estoque_milesimal + qtdMilesimal;
  db.prepare(
    `INSERT INTO estoque_movimentos (produto_id, tipo, qtd_milesimal, saldo_apos_milesimal,
                                     motivo, criado_em, data)
     VALUES (?, 'inventario', ?, ?, ?, ?, ?)`
  ).run(produtoId, qtdMilesimal, saldo, motivo, ts, data);
  db.prepare('UPDATE produtos SET estoque_milesimal = ? WHERE id = ?').run(saldo, produtoId);
}

function criarProdutoHistorico(db, linha, ts) {
  const id = db
    .prepare(
      `INSERT INTO produtos (nome, unidade, preco_centavos, estoque_milesimal,
                             controla_estoque, ativo, origem, criado_em, atualizado_em)
       VALUES (?, 'UN', ?, 0, 0, 0, 'historico', ?, ?)`
    )
    .run(String(linha.name ?? '(sem nome)'), paraCentavos(linha.price) ?? 0, ts, ts)
    .lastInsertRowid;

  const code = String(linha.code ?? '').trim();
  if (code) {
    // Pode colidir se o código foi reaproveitado por outro produto; nesse caso
    // o produto histórico fica sem código, o que é aceitável.
    try {
      db.prepare(
        `INSERT INTO produto_codigos (produto_id, codigo, tipo, fator_milesimal, principal, criado_em)
         VALUES (?, ?, 'EAN', 1000, 1, ?)`
      ).run(id, code, ts);
    } catch { /* código já pertence a outro produto */ }
  }
  return id;
}
