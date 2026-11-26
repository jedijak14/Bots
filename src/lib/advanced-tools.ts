/** Deterministic, bounded helpers used by the agent's analysis tools. */
export function describeNumbers(values: unknown) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10000 || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e100))
    return { error: 'Provide 1–10000 finite numbers with magnitude at most 1e100.' };
  const sorted = [...values].sort((a, b) => a - b) as number[];
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const quantile = (p: number) => {
    const pos = (n - 1) * p, i = Math.floor(pos), frac = pos - i;
    return sorted[i] + ((sorted[i + 1] ?? sorted[i]) - sorted[i]) * frac;
  };
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return { count: n, sum, mean, median: quantile(0.5), min: sorted[0], max: sorted[n - 1], q1: quantile(0.25), q3: quantile(0.75), populationStandardDeviation: Math.sqrt(variance), sampleStandardDeviation: n > 1 ? Math.sqrt(variance * n / (n - 1)) : null };
}

export function convertTime(instant: string, zones: unknown) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/i.test(instant)) return { error: 'Provide an ISO timestamp with an explicit UTC offset, e.g. 2026-11-24T12:00:00Z.' };
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:Z|([+-])(\d\d):(\d\d))$/i.exec(instant)!;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59 || Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return { error: 'Invalid timestamp.' };
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return { error: 'Invalid timestamp.' };
  if (!Array.isArray(zones) || zones.length < 1 || zones.length > 20 || zones.some(z => typeof z !== 'string' || z.length > 100)) return { error: 'Provide 1–20 IANA time zones.' };
  try {
    return { instant: date.toISOString(), times: zones.map(zone => ({ zone, local: new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(date) })) };
  } catch { return { error: 'Invalid IANA time zone. Use names like America/Los_Angeles or Europe/London.' }; }
}

export function loanEstimate(principal: unknown, annualRate: unknown, months: unknown) {
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal <= 0 || principal > 1e12 || typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1000 || typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 1200) return { error: 'Provide a positive principal (up to 1e12), an annual interest rate from 0 to 1000 percent, and 1–1200 whole months.' };
  const rate = annualRate / 1200;
  const payment = rate === 0 ? principal / months : principal * rate / (-Math.expm1(-months * Math.log1p(rate)));
  const round = (x: number) => Math.round(x * 100) / 100;
  return { monthlyPayment: round(payment), totalPayments: round(payment * months), totalInterest: round(payment * months - principal), assumption: 'Fixed-rate monthly payments; excludes fees, taxes and insurance. Totals use unrounded payments.' };
}

export function compareLines(before: string, after: string) {
  if (before.length > 50000 || after.length > 50000) return { error: 'Each text must be at most 50000 characters.' };
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  if (a.length > 500 || b.length > 500) return { error: 'Each text must contain at most 500 lines.' };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const changes: { type: string; line: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { changes.push({ type: 'unchanged', line: a[i] }); i++; j++; }
    else if (j < b.length && (i === a.length || dp[i][j + 1] > dp[i + 1][j])) { changes.push({ type: 'added', line: b[j++] }); }
    else { changes.push({ type: 'removed', line: a[i++] }); }
  }
  return { added: changes.filter(c => c.type === 'added').length, removed: changes.filter(c => c.type === 'removed').length, changes };
}
