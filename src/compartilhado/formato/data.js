// Datas trafegam como texto ISO ("AAAA-MM-DD") e horas como "HH:MM".
// A formatação é feita por fatiamento de string, nunca por new Date(iso) —
// parsear "2026-08-03" como Date joga o valor para UTC e vira 02/08 no Brasil.

/** Hoje no fuso local, "AAAA-MM-DD" */
export function hojeISO(d = new Date()) {
  return (
    d.getFullYear() +
    '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0')
  );
}

/** Agora no fuso local, "HH:MM" */
export function agoraHora(d = new Date()) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Agora no fuso local, "HH:MM:SS" */
export function agoraHoraSegundos(d = new Date()) {
  return agoraHora(d) + ':' + String(d.getSeconds()).padStart(2, '0');
}

/** Carimbo completo para colunas *_em: "AAAA-MM-DD HH:MM:SS" no fuso local */
export function agoraTimestamp(d = new Date()) {
  return hojeISO(d) + ' ' + agoraHoraSegundos(d);
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" */
export function formatarDataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d + '/' + m + '/' + a;
}

/** "AAAA-MM-DD HH:MM:SS" → "DD/MM/AAAA HH:MM" */
export function formatarDataHoraBR(ts) {
  if (!ts) return '';
  const s = String(ts);
  return formatarDataBR(s.slice(0, 10)) + ' ' + s.slice(11, 16);
}

/** Soma dias a uma data ISO, devolvendo ISO (usado em vencimento de fiado) */
export function somarDiasISO(iso, dias) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  return hojeISO(dt);
}
