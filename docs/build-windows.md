# Gerar o instalador no Windows

```bash
npm run dist
```

Saída: `dist/Sistema de Vendas <versão> - instalador.exe` (NSIS, ~106 MB).

## Duas pedras no caminho, já contornadas

### 1. `node-gyp failed to rebuild better-sqlite3`

O `electron-builder` tenta recompilar dependências nativas antes de empacotar,
e isso exigiria Visual Studio Build Tools instalado.

Não é necessário: o `better-sqlite3` 13 publica prebuilds N-API por plataforma
(`node_modules/better-sqlite3/prebuilds/win32-x64.node`), que servem tanto para
o Electron quanto para o app empacotado. Por isso o `electron-builder.yml` tem
`npmRebuild: false` — e por isso o `package.json` **não** tem o
`postinstall: electron-builder install-app-deps` que normalmente se recomenda.

### 2. `Cannot create symbolic link ... winCodeSign`

Para assinar o executável, o `electron-builder` baixa e extrai o pacote
`winCodeSign`, que contém symlinks de macOS. Criar symlink no Windows exige
privilégio que uma conta comum não tem, e a extração falha antes de o
instalador ser gerado.

Contorno atual: `win.signAndEditExecutable: false` no `electron-builder.yml`.
O instalador sai normal e funcional, **mas o `.exe` fica sem ícone próprio e
sem os metadados de versão**.

Para gerar o instalador completo, ative o **Modo de Desenvolvedor** do Windows
(Configurações → Sistema → Para desenvolvedores → Modo de Desenvolvedor) e
remova a linha `signAndEditExecutable: false`. Ative também ao adicionar o
ícone em `recursos/icone.ico`.

## SmartScreen

O instalador não é assinado digitalmente, então o Windows mostra
*"O Windows protegeu o seu PC"*. Para instalar: **Mais informações →
Executar assim mesmo**.

Enquanto for uma loja só, instalar presencialmente resolve. Quando houver
atualização automática, vale contratar assinatura de código — a opção mais
barata hoje é o **Azure Trusted Signing** (~US$ 10/mês, suportado pelo
`electron-builder`, sem exigir token USB).

## O que o instalador faz

- Instala por usuário (`perMachine: false`), sem exigir administrador.
- Deixa o usuário escolher a pasta.
- Cria atalho na área de trabalho e no menu Iniciar.
- **Não apaga os dados ao desinstalar** (`deleteAppDataOnUninstall: false`).
  O banco fica em `%APPDATA%\pdv-amanda\pdv.db` e sobrevive a
  desinstalação e reinstalação.
