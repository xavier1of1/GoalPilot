export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function dollarsToCents(value: string): number {
  const normalized = value.replaceAll(',', '').replace('$', '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) throw new Error('Enter a valid dollar amount.');
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}% APY`;
}

export function formatDate(value: string | null): string {
  if (value === null) return 'Not projected';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
