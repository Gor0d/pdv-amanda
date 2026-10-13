-- Até aqui, inativar um produto não liberava o código de barras dele: a
-- tabela produto_codigos tem índice único em `codigo`, então cadastrar um
-- produto novo com o mesmo código de um já excluído falhava com "código já
-- pertence a outro produto" — mesmo o outro estando fora da loja.
--
-- produto_codigos não é histórico (a venda já guarda o snapshot próprio em
-- venda_itens.codigo_barras), então não tem problema nenhum apagar os códigos
-- de quem já está inativo. Faz isso uma vez aqui pra destravar quem já tinha
-- produto excluído antes dessa correção existir.
DELETE FROM produto_codigos
 WHERE produto_id IN (SELECT id FROM produtos WHERE ativo = 0);
