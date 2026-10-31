// format.ts - small helpers shared by the screens.

// Money is stored as whole PAISE (250000 = ₹2,500.00) so there are no
// rounding errors. We only turn it into rupees for display.
export function rupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2500.50" typed by the user -> 250050 paise. Math.round fixes float noise
// (2500.55 * 100 = 250054.99999...). Returns null for bad input.
export function toPaise(text: string): number | null {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// Today / N days from today as 'YYYY-MM-DD' in LOCAL time.
// WHY not toISOString()? That is UTC, so in India before 5:30 AM it gives yesterday.
export function isoDate(daysFromToday = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Turns any thrown thing into text for the red error box.
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
