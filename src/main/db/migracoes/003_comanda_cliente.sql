-- Nome do cliente como campo próprio, separado da mesa/local (identificador).
-- Uma mesma "Mesa 4" pode passar por gente diferente ao longo da noite; ter os
-- dois campos deixa o cartão da comanda dizer "Mesa 4 · João" em vez de só um
-- texto livre tentando carregar as duas informações.
ALTER TABLE comandas ADD COLUMN cliente_nome TEXT;
