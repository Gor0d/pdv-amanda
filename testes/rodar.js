// Roda os testes sob o Node embutido no Electron.
//
// better-sqlite3 é módulo nativo: o binário publicado casa com o Electron, não
// com o Node instalado na máquina — `node --test` direto derruba o processo
// com access violation. Com ELECTRON_RUN_AS_NODE=1 o binário do Electron vira
// um Node comum, e os testes rodam no mesmo runtime do app em produção, que é
// justamente onde interessa que passem.
//
// Este arquivo é o lançador: `node testes/rodar.js`. Ele re-executa a si mesmo
// dentro do Electron (bloco 1) e ali roda a suíte (bloco 2).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const esteArquivo = fileURLToPath(import.meta.url);
const raiz = path.dirname(path.dirname(esteArquivo));

if (!process.env.PDV_TESTES_DENTRO_DO_ELECTRON) {
  // ---- Bloco 1: ainda no Node da máquina, relançar dentro do Electron ----
  const require = createRequire(import.meta.url);
  const electron = require('electron'); // caminho do executável

  const filho = spawn(electron, [esteArquivo, ...process.argv.slice(2)], {
    cwd: raiz,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PDV_TESTES_DENTRO_DO_ELECTRON: '1'
    }
  });
  filho.on('exit', (codigo) => process.exit(codigo ?? 1));
} else {
  // ---- Bloco 2: já dentro do Electron-como-Node ----
  // A flag --test não sobrevive à linha de comando do Electron, então usamos a
  // API programática do runner.
  const { run } = await import('node:test');
  const { tap } = await import('node:test/reporters');

  const alvos = process.argv.slice(2);
  const arquivos = alvos.length
    ? alvos.map((a) => path.resolve(raiz, a))
    : listarTestes(path.join(raiz, 'testes', 'unidade'));

  let falhou = false;
  run({ files: arquivos, concurrency: 1 })
    .on('test:fail', () => { falhou = true; })
    .compose(tap)
    .pipe(process.stdout)
    .on('finish', () => process.exit(falhou ? 1 : 0));
}

function listarTestes(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join(dir, f));
}
