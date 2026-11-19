/**
 * Form doğrulama — zod v4, Türkçe ve eyleme dönük hata mesajları.
 * Kural: hata mesajı neyin yanlış olduğunu VE nasıl düzeltileceğini söyler.
 */
import { z } from 'zod';

import type { FieldErrors, FormResult } from '@/types';

export const PASSWORD_MIN_LENGTH = 8;
/** Supabase (bcrypt) 72 bayttan uzun şifreleri keser; kullanıcıyı önceden uyar. */
export const PASSWORD_MAX_LENGTH = 72;

export const emailSchema = z
  .string({ error: 'E-posta adresi gerekli.' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'E-posta adresi gerekli.' })
  .pipe(z.email({ error: 'Geçerli bir e-posta adresi girin (ör. ad@ornek.com).' }));

export const passwordSchema = z
  .string({ error: 'Şifre gerekli.' })
  .min(1, { error: 'Şifre gerekli.' })
  .min(PASSWORD_MIN_LENGTH, { error: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.` });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Şifre gerekli.' }).min(1, { error: 'Şifre gerekli.' }),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Şifreyi tekrar girin.' }).min(1, { error: 'Şifreyi tekrar girin.' }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: 'Şifreler eşleşmiyor.',
    path: ['confirmPassword'],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;

/**
 * Şemayı çalıştırır; her alan için yalnızca İLK hatayı döndürür
 * (kullanıcıya aynı anda üç kural göstermek bilişsel yük yaratır).
 */
export function validateForm<S extends z.ZodType>(schema: S, values: unknown): FormResult<z.output<S>> {
  const result = schema.safeParse(values);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }
  return { success: false, errors };
}

/** Tek alanı doğrular (onBlur geri bildirimi için). */
export function validateField<S extends z.ZodType>(schema: S, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** Şifre gücü göstergesi (0–4) — kayıt ekranında canlı geri bildirim */
export function getPasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-zçğıöşü]/.test(password) && /[A-ZÇĞİÖŞÜ]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9çğıöşüÇĞİÖŞÜ]/.test(password)) score += 1;
  return Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
}

export const PASSWORD_STRENGTH_LABELS = ['', 'Zayıf', 'Orta', 'İyi', 'Güçlü'] as const;
