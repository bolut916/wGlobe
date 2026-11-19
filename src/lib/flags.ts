/** ISO 3166-1 alpha-2 → bayrak emojisi ("TR" → 🇹🇷). Geçersiz kodda 🌐 döner. */
export function countryCodeToFlag(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  return String.fromCodePoint(...[...code].map((char) => REGIONAL_INDICATOR_A + char.charCodeAt(0) - 65));
}
