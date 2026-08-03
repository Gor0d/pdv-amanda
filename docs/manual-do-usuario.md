# Manual do Sistema de Vendas

## Aviso importante sobre nota fiscal

Este sistema emite **comprovante de venda não-fiscal**. Ele serve para o
cliente conferir o que comprou e para você acompanhar o movimento da loja.

**Ele não substitui documento fiscal.** Se a sua loja é obrigada a emitir
NFC-e (Nota Fiscal de Consumidor Eletrônica) no seu estado, essa obrigação
continua valendo e precisa ser cumprida pelos meios que o seu contador
orientar. Converse com o seu contador antes de usar este sistema como único
registro de vendas.

A emissão de NFC-e está prevista para uma versão futura.

---

## Vendendo

1. Abra a aba **Vender** (é a que abre sozinha ao ligar o programa).
2. **Bipe o produto.** O leitor funciona como um teclado: ele digita o código
   e aperta Enter sozinho. Não precisa clicar em nada antes.
3. O produto aparece no cupom da tela. Bipar o mesmo produto de novo aumenta a
   quantidade.
4. Para vender várias unidades de uma vez, digite **3\*** antes do código:
   `3*7891000100103` adiciona 3 unidades.
5. Aperte **F8** (ou clique em "Finalizar venda").

### Se você clicou em algum lugar e o bipe não funcionou

Não tem problema: basta bipar de novo. O sistema devolve o foco para o campo
de leitura automaticamente assim que o leitor começa a digitar.

### Atalhos do teclado

| Tecla | O que faz |
|---|---|
| `F2` | Buscar produto pelo nome (para itens sem código de barras) |
| `F3` | Mudar a quantidade do item selecionado |
| `F7` | Tirar o item selecionado da venda |
| `F8` | Finalizar a venda |
| `F12` | Cancelar a venda inteira |
| `↑` `↓` | Escolher um item do cupom |
| `+` `−` | Aumentar/diminuir a quantidade do item escolhido |

### Produto que não está cadastrado

Quando você bipa um código desconhecido, o sistema pergunta se quer cadastrar
na hora. Preencha nome e preço e ele já entra na venda — não precisa parar o
atendimento para ir até a aba Estoque.

---

## Estoque

- **Cadastrar produto:** aba Estoque, preencha o formulário de cima e salve.
  O código de barras é opcional (produtos sem código são achados pelo `F2`).
- **Chegou mercadoria:** clique no `↓` na linha do produto e informe quanto
  chegou. Isso fica registrado com data e motivo.
- **Editar:** o `✎` abre o produto no formulário. Mudar a quantidade ali
  registra um ajuste, com motivo, no histórico.
- **Tirar da lista:** o `🗑` esconde o produto das buscas, mas ele continua no
  histórico das vendas antigas. Nada é apagado de verdade.

As linhas ficam **laranja** quando o estoque está baixo e **vermelhas** quando
zera.

---

## Relatórios

Escolha uma data para ver o total vendido, os itens vendidos, o que saiu mais
e como está o estoque. Os botões arredondados no topo são atalhos para os
últimos dias que tiveram venda.

Na lista **Vendas do dia** você pode ver o detalhe de uma venda (`👁`) ou
cancelá-la (`✕`). Cancelar devolve os produtos ao estoque e tira o valor do
total do dia — mas a venda continua registrada como cancelada, com o motivo.

---

## Backup — leia isto

Todos os seus dados ficam em **um arquivo só**, nesta máquina. Se o
computador quebrar ou for roubado sem backup, os dados vão junto.

Na aba **Ajustes**:

- **Fazer backup agora** grava uma cópia na pasta de backups.
- **Abrir pasta de backups** mostra onde as cópias estão. Se o computador tem
  OneDrive, o sistema usa a pasta do OneDrive — assim a cópia já sai da
  máquina automaticamente.
- **Conferir estoque** verifica se os saldos batem com o histórico de
  movimentações e corrige o que estiver errado.

**Recomendação:** faça o backup no fim de cada dia e, uma vez por semana,
copie um arquivo de backup para um pen drive.

**Recomendação de equipamento:** um nobreak simples evita perder a venda em
andamento quando falta luz. É o melhor dinheiro que se gasta neste sistema.
Se faltar energia no meio de uma venda, ao religar o programa pergunta se você
quer continuar a venda que estava aberta.

---

## Trazendo os dados do sistema antigo

1. Abra o sistema antigo, vá em **Relatórios** e clique em
   **Exportar dados (JSON)**. Guarde o arquivo.
2. Aqui, vá em **Ajustes → Trazer dados do sistema anterior** e escolha esse
   arquivo.
3. O sistema mostra quantos produtos e vendas trouxe.

Importar o mesmo arquivo duas vezes não duplica nada — pode clicar sem medo.

O estoque importado é o saldo **atual** do sistema antigo. As vendas antigas
entram só como histórico de faturamento e não descontam nada do estoque de
novo.

---

## Quando algo der errado

Na aba **Ajustes**, no fim da página, estão a versão do sistema e o caminho do
arquivo de dados. Anote essas informações e o horário em que o problema
aconteceu antes de pedir ajuda.
