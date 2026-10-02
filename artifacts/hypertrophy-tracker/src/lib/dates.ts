/** Local calendar helpers. Never derive dates from UTC ISO truncation. */
const pad = (n: number) => String(n).padStart(2, '0');
export const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localToday = () => toDateString(new Date());
export function parseDate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const addDays = (s: string, n: number) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateString(d); };
export const daysBetween = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
export const fmtDate = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => parseDate(s).toLocaleDateString(undefined, opts);
const PATTERNS: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
export const dayOffsets = (n: number) => PATTERNS[Math.min(7, Math.max(1, n))].concat(n > 7 ? Array.from({ length: n - 7 }, () => 6) : []).slice(0, n);
