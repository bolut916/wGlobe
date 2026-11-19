/**
 * Supabase Auth hatalarını kullanıcı dostu Türkçe mesajlara çevirir.
 * Ham İngilizce hata metni asla kullanıcıya gösterilmez.
 */
import { SupabaseNotConfiguredError } from './supabase';

interface AuthLikeError {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-posta veya şifre hatalı. Lütfen tekrar deneyin.',
  email_not_confirmed: 'E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzdaki bağlantıya dokunun.',
  user_already_exists: 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.',
  email_exists: 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.',
  weak_password: 'Şifre çok zayıf. Harf, rakam ve sembol karıştırarak en az 8 karakter kullanın.',
  over_request_rate_limit: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.',
  over_email_send_rate_limit: 'Çok fazla e-posta istendi. Birkaç dakika sonra tekrar deneyin.',
  signup_disabled: 'Yeni üyelikler şu anda kapalı.',
  email_address_invalid: 'Bu e-posta adresi kabul edilmiyor. Farklı bir adres deneyin.',
  session_expired: 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.',
  session_not_found: 'Oturum bulunamadı. Lütfen yeniden giriş yapın.',
  user_not_found: 'Bu e-postaya ait bir hesap bulunamadı.',
  same_password: 'Yeni şifre eskisiyle aynı olamaz.',
};

const MESSAGE_PATTERNS: [RegExp, string][] = [
  [/invalid login credentials/i, CODE_MESSAGES.invalid_credentials as string],
  [/email not confirmed/i, CODE_MESSAGES.email_not_confirmed as string],
  [/already registered|already exists/i, CODE_MESSAGES.user_already_exists as string],
  [/password should be at least/i, 'Şifre en az 8 karakter olmalı.'],
  [/rate limit|too many requests/i, CODE_MESSAGES.over_request_rate_limit as string],
  [/network request failed|failed to fetch|network error/i, 'İnternet bağlantısı yok gibi görünüyor. Bağlantınızı kontrol edip tekrar deneyin.'],
  [/timeout|timed out/i, 'Sunucu zamanında yanıt vermedi. Tekrar deneyin.'],
  [/jwt expired/i, CODE_MESSAGES.session_expired as string],
];

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof SupabaseNotConfiguredError) {
    return error.message;
  }
  const authError = (error ?? {}) as AuthLikeError;

  if (authError.code && CODE_MESSAGES[authError.code]) {
    return CODE_MESSAGES[authError.code] as string;
  }
  const message = authError.message ?? '';
  for (const [pattern, translated] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return translated;
  }
  if (authError.status === 429) return CODE_MESSAGES.over_request_rate_limit as string;
  if (authError.status && authError.status >= 500) {
    return 'Sunucuda geçici bir sorun var. Lütfen biraz sonra tekrar deneyin.';
  }
  return 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
}
