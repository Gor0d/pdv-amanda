import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// O preload e o registrarIpc são dois arquivos que precisam concordar em cada
// nome de canal. Um erro de digitação num deles só apareceria quando a dona da
// loja clicasse no botão — este teste pega antes, sem precisar subir o app.

const raiz = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const preload = fs.readFileSync(path.join(raiz, 'src/preload/preload.cjs'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src/main/ipc/registrarIpc.js'), 'utf8');

const canaisDoPreload = [...preload.matchAll(/chamar\('([^']+)'\)/g)].map((m) => m[1]);
const canaisDoMain = [...ipc.matchAll(/canal\('([^']+)'/g)].map((m) => m[1]);

test('todo canal exposto no preload tem handler no main', () => {
  const semHandler = canaisDoPreload.filter((c) => !canaisDoMain.includes(c));
  assert.deepEqual(semHandler, [], `canais sem handler: ${semHandler.join(', ')}`);
});

test('todo handler do main está exposto no preload', () => {
  const semExposicao = canaisDoMain.filter((c) => !canaisDoPreload.includes(c));
  assert.deepEqual(semExposicao, [], `handlers inalcançáveis: ${semExposicao.join(', ')}`);
});

test('nenhum canal duplicado', () => {
  const dup = canaisDoMain.filter((c, i) => canaisDoMain.indexOf(c) !== i);
  assert.deepEqual(dup, []);
  assert.ok(canaisDoMain.length >= 20, 'o contrato deveria ter os canais das 4 telas');
});

test('as telas só chamam métodos que existem na api', () => {
  // Extrai `grupo: { metodo: ... }` do preload para saber o que existe.
  const disponiveis = new Set();
  for (const m of preload.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    const grupo = m[1];
    for (const met of m[2].matchAll(/(\w+):\s*chamar/g)) disponiveis.add(`${grupo}.${met[1]}`);
  }

  const dirTelas = path.join(raiz, 'src/renderer/js');
  const usados = new Set();
  for (const arquivo of listarJs(dirTelas)) {
    const src = fs.readFileSync(arquivo, 'utf8');
    for (const m of src.matchAll(/\bapi\.(\w+)\.(\w+)\s*\(/g)) usados.add(`${m[1]}.${m[2]}`);
  }

  const inexistentes = [...usados].filter((u) => !disponiveis.has(u));
  assert.deepEqual(inexistentes, [], `a tela chama o que o preload não expõe: ${inexistentes.join(', ')}`);
});

function listarJs(dir) {
  const saida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...listarJs(p));
    else if (entrada.name.endsWith('.js')) saida.push(p);
  }
  return saida;
}
