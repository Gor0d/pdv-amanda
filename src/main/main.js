import electron from 'electron'; // ver comentário em util/caminhos.js
import log from 'electron-log/main.js';

const { app, dialog } = electron;
import { abrirBanco, fecharBanco } from './db/conexao.js';
import { registrarIpc } from './ipc/registrarIpc.js';
import { registrarEsquemaPrivilegiado, registrarProtocolo, criarJanela } from './janela.js';
import { caminhoBanco } from './util/caminhos.js';

const dev = process.argv.includes('--dev');

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = dev ? 'debug' : 'warn';

app.setAppUserModelId('com.pdvamanda.app');

// Duas instâncias no mesmo SQLite é risco desnecessário — a segunda apenas
// traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let janela = null;

  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  // Obrigatoriamente antes do whenReady().
  registrarEsquemaPrivilegiado();

  app.whenReady().then(() => {
    try {
      abrirBanco(caminhoBanco(), { log });
    } catch (e) {
      log.error('Falha ao abrir o banco', e);
      dialog.showErrorBox(
        'Não foi possível abrir os dados',
        'O arquivo de dados do sistema não pôde ser aberto.\n\n' +
          `Detalhe técnico: ${e.message}\n\n` +
          'Nada foi alterado. Feche o programa e chame o suporte.'
      );
      app.quit();
      return;
    }

    registrarProtocolo({ log });
    registrarIpc({ log });
    janela = criarJanela({ dev, log });
  });

  app.on('window-all-closed', () => {
    fecharBanco();
    app.quit();
  });

  process.on('uncaughtException', (e) => log.error('Exceção não tratada', e));
}
