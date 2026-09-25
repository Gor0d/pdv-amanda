import electron from 'electron'; // ver comentário em util/caminhos.js
import fs from 'node:fs/promises';

const { BrowserWindow, dialog } = electron;

// Folha de estilo mínima pro documento impresso — preto no branco, sem a
// paleta escura do app (que não serve pra imprimir), com tabelas legíveis.
const ESTILO_IMPRESSAO = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1F2A22; margin: 24px 32px; font-size: 12.5px; }
  h1 { font-size: 18px; margin: 0 0 4px 0; }
  .sub { color: #5B6459; font-size: 12px; margin-bottom: 18px; }
  h2 { font-size: 13.5px; text-transform: uppercase; letter-spacing: .4px; margin: 22px 0 8px 0; border-bottom: 1px solid #DAD5C6; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; color: #5B6459; padding: 6px 8px; border-bottom: 1.5px solid #1F2A22; }
  td { padding: 6px 8px; border-bottom: 1px solid #E6E1D3; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .stat-row { display: flex; gap: 24px; margin: 10px 0 4px 0; }
  .stat .label { font-size: 10.5px; text-transform: uppercase; color: #5B6459; }
  .stat .value { font-size: 16px; font-weight: 700; }
  .rodape { margin-top: 24px; font-size: 10.5px; color: #5B6459; }
  @page { margin: 14mm 12mm; }
`;

/**
 * Gera um PDF a partir de um fragmento HTML (já escapado pelo chamador) e
 * pergunta onde salvar. Usa printToPDF do Chromium embutido — sem depender de
 * nenhuma lib externa de PDF.
 *
 * @returns {Promise<string|null>} caminho salvo, ou null se cancelou o diálogo
 */
export async function exportarPdf({ titulo, html, sugestaoNome }, { log = console } = {}) {
  const r = await dialog.showSaveDialog({
    title: 'Salvar relatório em PDF',
    defaultPath: sugestaoNome || 'relatorio.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return null;

  const janela = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    const documento = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>${escaparTitulo(titulo)}</title>
      <style>${ESTILO_IMPRESSAO}</style>
      </head><body>${html}</body></html>`;

    await janela.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(documento));
    const buffer = await janela.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4'
    });
    await fs.writeFile(r.filePath, buffer);
    log.info?.(`PDF salvo em ${r.filePath}`);
    return r.filePath;
  } finally {
    janela.destroy();
  }
}

function escaparTitulo(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
