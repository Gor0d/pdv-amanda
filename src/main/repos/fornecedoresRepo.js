import { obterBanco } from '../db/conexao.js';
import { agoraTimestamp } from '../../compartilhado/formato/data.js';

const CAMPOS = 'id, nome, cpf_cnpj, telefone, email, endereco, observacoes, ativo';

export function porId(id) {
  return obterBanco().prepare(`SELECT ${CAMPOS} FROM fornecedores WHERE id = ?`).get(id) || null;
}

export function listar({ termo = '', apenasAtivos = true, limite = 200 } = {}) {
  const like = `%${String(termo).trim().toLowerCase()}%`;
  return obterBanco()
    .prepare(
      `SELECT ${CAMPOS} FROM fornecedores
        WHERE (? = 0 OR ativo = 1)
          AND (? = '' OR lower(nome) LIKE ? OR lower(coalesce(cpf_cnpj,'')) LIKE ?)
        ORDER BY nome
        LIMIT ?`
    )
    .all(apenasAtivos ? 1 : 0, String(termo).trim(), like, like, limite);
}

export function criar(dados) {
  const ts = agoraTimestamp();
  const info = obterBanco()
    .prepare(
      `INSERT INTO fornecedores (nome, cpf_cnpj, telefone, email, endereco, observacoes, ativo, criado_em, atualizado_em)
       VALUES (@nome, @cpf_cnpj, @telefone, @email, @endereco, @observacoes, 1, @ts, @ts)`
    )
    .run({
      nome: dados.nome,
      cpf_cnpj: dados.cpfCnpj || null,
      telefone: dados.telefone || null,
      email: dados.email || null,
      endereco: dados.endereco || null,
      observacoes: dados.observacoes || null,
      ts
    });
  return info.lastInsertRowid;
}

export function atualizar(id, dados) {
  obterBanco()
    .prepare(
      `UPDATE fornecedores
          SET nome = @nome, cpf_cnpj = @cpf_cnpj, telefone = @telefone, email = @email,
              endereco = @endereco, observacoes = @observacoes, atualizado_em = @ts
        WHERE id = @id`
    )
    .run({
      id,
      nome: dados.nome,
      cpf_cnpj: dados.cpfCnpj || null,
      telefone: dados.telefone || null,
      email: dados.email || null,
      endereco: dados.endereco || null,
      observacoes: dados.observacoes || null,
      ts: agoraTimestamp()
    });
}

/** Fornecedor nunca é apagado, só inativado — mesma regra de produtos. */
export function inativar(id) {
  obterBanco()
    .prepare('UPDATE fornecedores SET ativo = 0, atualizado_em = ? WHERE id = ?')
    .run(agoraTimestamp(), id);
}

export function reativar(id) {
  obterBanco()
    .prepare('UPDATE fornecedores SET ativo = 1, atualizado_em = ? WHERE id = ?')
    .run(agoraTimestamp(), id);
}
