const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function bytes(size: number): string {
  const unit = Math.min(3, Math.max(0, Math.floor(Math.log(Math.max(1, size)) / Math.log(1024))));
  return `${numbers.format(size / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export const dateTime = (ms: number): string => timestamp.format(ms);
export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = (ms - now) / 1000;
  const [scale, unit]: [number, Intl.RelativeTimeFormatUnit] = Math.abs(seconds) < 60 ? [1, 'second'] : Math.abs(seconds) < 3600 ? [60, 'minute'] : Math.abs(seconds) < 86400 ? [3600, 'hour'] : [86400, 'day'];
  return relative.format(Math.round(seconds / scale), unit);
}
