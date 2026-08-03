import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// O módulo 'electron' é um builtin injetado no runtime, não um arquivo CJS
// comum: o loader ESM não consegue extrair exports nomeados dele. Por isso
// todo o main importa o default e desestrutura.
import electron from 'electron';

const { app } = electron;

/** Banco de dados: %APPDATA%\pdv-amanda\pdv.db */
export function caminhoBanco() {
  return path.join(app.getPath('userData'), 'pdv.db');
}

/**
 * Pasta de trabalho visível para a dona da loja.
 * Se existir OneDrive, usamos ele: backup fora da máquina sem custo nenhum,
 * o que resolve metade do risco de perder tudo num HD que morreu.
 */
export function pastaPdv() {
  const oneDrive = process.env.OneDrive || path.join(os.homedir(), 'OneDrive');
  const base = fs.existsSync(oneDrive) ? oneDrive : app.getPath('documents');
  return path.join(base, 'PDV');
}

export function pastaBackups() {
  return garantir(path.join(pastaPdv(), 'backups'));
}

export function pastaCupons(data = new Date()) {
  const mes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
  return garantir(path.join(pastaPdv(), 'cupons', mes));
}

export function garantir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
