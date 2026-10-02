export type WeightUnit = 'kg' | 'lb';
export const LB_PER_KG = 2.20462262185;

export const toDisplay = (kg: number, unit: WeightUnit) => (unit === 'lb' ? kg * LB_PER_KG : kg);
export const toKg = (value: number, unit: WeightUnit) => Math.round((unit === 'lb' ? value / LB_PER_KG : value) * 10000) / 10000;

export function fmtNum(v: number, max = 1) {
  return Number(v.toFixed(max)).toLocaleString(undefined, { maximumFractionDigits: max });
}
/** Display a stored kg weight in the profile unit. */
export function fmtWeight(kg: number | null | undefined, unit: WeightUnit, withUnit = true) {
  if (kg === null || kg === undefined) return '—';
  const text = fmtNum(toDisplay(kg, unit), unit === 'lb' ? 1 : 2);
  return withUnit ? `${text} ${unit}` : text;
}
/** Raw numeric string for an input element (no grouping). */
export function inputValue(kg: number | null | undefined, unit: WeightUnit) {
  if (kg === null || kg === undefined) return '';
  return String(Number(toDisplay(kg, unit).toFixed(unit === 'lb' ? 1 : 2)));
}
/** null = empty, NaN = invalid, else kg. */
export function parseInputToKg(text: string, unit: WeightUnit): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return toKg(n, unit);
}
export function parseIntOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
/** Total weight lifted, whole display units. */
export function fmtTotal(kg: number, unit: WeightUnit) {
  return `${Math.round(toDisplay(kg, unit)).toLocaleString()} ${unit}`;
}
/** Rounds parts so they sum exactly to the rounded total (largest remainder). */
export function reconcileTotals(totalKg: number, parts: { label: string; kg: number }[], unit: WeightUnit) {
  const total = Math.round(toDisplay(totalKg, unit));
  const raw = parts.map((p) => toDisplay(p.kg, unit));
  const floors = raw.map((v) => Math.floor(v));
  let diff = total - floors.reduce((a, b) => a + b, 0);
  const out = [...floors];
  if (diff >= 0 && diff <= parts.length) {
    raw.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r).forEach(({ i }) => { if (diff > 0) { out[i] += 1; diff -= 1; } });
  } else raw.forEach((v, i) => { out[i] = Math.round(v); });
  return { total, parts: parts.map((p, i) => ({ label: p.label, value: out[i] })) };
}
