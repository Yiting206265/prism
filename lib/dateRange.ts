export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAYS_BACK = 90;

export function isValidDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;

  const picked = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(picked.getTime())) return false;

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const earliest = new Date(todayUTC);
  earliest.setUTCDate(earliest.getUTCDate() - MAX_DAYS_BACK);

  return picked >= earliest && picked <= todayUTC;
}
