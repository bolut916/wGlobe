/**
 * Şehir saatleri — Intl.DateTimeFormat + IANA saat dilimleri.
 * Formatter'lar önbelleğe alınır: saniyede bir yeniden çizilen saat için
 * her tikte yeni formatter oluşturmak Hermes'te ölçülebilir maliyet yaratır.
 */
const LOCALE = 'tr-TR';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string, options: Intl.DateTimeFormatOptions, variant: string): Intl.DateTimeFormat | null {
  const cacheKey = `${variant}|${timeZone}`;
  const cached = formatterCache.get(cacheKey);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
    formatterCache.set(cacheKey, formatter);
    return formatter;
  } catch {
    return null;
  }
}

const pad2 = (value: number) => String(value).padStart(2, '0');

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Bir anın verilen saat dilimindeki takvim/saat bileşenleri. */
export function getZonedParts(timeZone: string, date: Date = new Date()): ZonedParts {
  const formatter = getFormatter(
    timeZone,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
    'parts',
  );

  if (formatter && typeof formatter.formatToParts === 'function') {
    try {
      const parts = formatter.formatToParts(date);
      const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
      const hour = read('hour');
      return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: hour === 24 ? 0 : hour,
        minute: read('minute'),
        second: read('second'),
      };
    } catch {
      // aşağıdaki yedeğe düş
    }
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/** Şehrin yerel saati: "21:04:37" (saniyeli) veya "21:04" */
export function formatCityTime(timeZone: string, date: Date = new Date(), withSeconds = true): string {
  const { hour, minute, second } = getZonedParts(timeZone, date);
  return withSeconds ? `${pad2(hour)}:${pad2(minute)}:${pad2(second)}` : `${pad2(hour)}:${pad2(minute)}`;
}

/** "19 Kasım Perşembe" */
export function formatCityDate(timeZone: string, date: Date = new Date()): string {
  const formatter = getFormatter(timeZone, { day: 'numeric', month: 'long', weekday: 'long' }, 'date');
  try {
    return formatter ? formatter.format(date) : date.toLocaleDateString(LOCALE);
  } catch {
    return date.toLocaleDateString(LOCALE);
  }
}

/** UTC'ye göre fark (dakika); yaz saati uygulaması dahil. */
export function getUtcOffsetMinutes(timeZone: string, date: Date = new Date()): number {
  const parts = getZonedParts(timeZone, date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const actual = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - actual) / 60_000);
}

/** "UTC+3", "UTC−3:30", "UTC" */
export function formatUtcOffset(timeZone: string, date: Date = new Date()): string {
  const offset = getUtcOffsetMinutes(timeZone, date);
  if (offset === 0) return 'UTC';
  const sign = offset > 0 ? '+' : '−';
  const absolute = Math.abs(offset);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad2(minutes)}`;
}

/** Kullanıcının cihazına göre saat farkı: "+6 sa", "−2 sa 30 dk", "Aynı saat" */
export function formatRelativeToDevice(timeZone: string, date: Date = new Date()): string {
  const deviceOffset = -date.getTimezoneOffset();
  const diff = getUtcOffsetMinutes(timeZone, date) - deviceOffset;
  if (diff === 0) return 'Aynı saat';
  const sign = diff > 0 ? '+' : '−';
  const absolute = Math.abs(diff);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0 ? `${sign}${hours} sa` : `${sign}${hours} sa ${minutes} dk`;
}

export function getLocalHour(timeZone: string, date: Date = new Date()): number {
  return getZonedParts(timeZone, date).hour;
}

export type DayPhase = 'şafak' | 'sabah' | 'öğleden sonra' | 'akşam' | 'gece';

export function getDayPhase(timeZone: string, date: Date = new Date()): DayPhase {
  const hour = getLocalHour(timeZone, date);
  if (hour >= 5 && hour < 7) return 'şafak';
  if (hour >= 7 && hour < 12) return 'sabah';
  if (hour >= 12 && hour < 17) return 'öğleden sonra';
  if (hour >= 17 && hour < 21) return 'akşam';
  return 'gece';
}

/** Seyahat Pasaportu damgası: "19.11.2026 · 21:04" (cihaz saatine göre) */
export function formatPassportStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()} · ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`;
}

/** Uyku zamanlayıcısı geri sayımı: "29:58" veya "1:04:12" */
export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}
