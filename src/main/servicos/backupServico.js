import fs from 'node:fs';
import path from 'node:path';
import { obterBanco } from '../db/conexao.js';
import { pastaBackups } from '../util/caminhos.js';
import { hojeISO, agoraHoraSegundos } from '../../compartilhado/formato/data.js';

const RETENCAO = 30;

/**
 * Cópia consistente do banco usando o backup online do SQLite — funciona com
 * o app aberto e com WAL ativo, ao contrário de copiar o arquivo na mão.
 */
export async function backupAgora({ log = console } = {}) {
  const dir = pastaBackups();
  const nome = `pdv-${hojeISO()}-${agoraHoraSegundos().replaceAll(':', '')}.db`;
  const destino = path.join(dir, nome);

  await obterBanco().backup(destino);
  limparAntigos(dir, log);

  log.info?.(`Backup gerado em ${destino}`);
  return { caminho: destino, pasta: dir };
}

export function ultimoBackup() {
  const dir = pastaBackups();
  const arquivos = listar(dir);
  if (!arquivos.length) return null;
  const ultimo = arquivos[0];
  const st = fs.statSync(path.join(dir, ultimo));
  return { arquivo: ultimo, pasta: dir, tamanhoBytes: st.size, em: st.mtime.toISOString() };
}

function listar(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('pdv-') && f.endsWith('.db'))
    .sort()
    .reverse();
}

function limparAntigos(dir, log) {
  const antigos = listar(dir).slice(RETENCAO);
  for (const f of antigos) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch (e) {
      log.warn?.(`Não foi possível remover o backup antigo ${f}: ${e.message}`);
    }
  }
}
