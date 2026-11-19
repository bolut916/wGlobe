/**
 * AsyncStorage tipli yardımcıları. Hassas olmayan, cihaza özgü veriler içindir
 * (misafir favorileri, tema, son şehir). Hiçbir fonksiyon hata fırlatmaz:
 * depolama hatası kullanıcı deneyimini durdurmamalı.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '@/constants/storageKeys';

export async function getString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] okuma başarısız: ${key}`, error);
    return null;
  }
}

export async function setString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[storage] yazma başarısız: ${key}`, error);
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`[storage] silme başarısız: ${key}`, error);
  }
}

export async function removeKeys(keys: readonly string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...keys]);
  } catch (error) {
    console.warn('[storage] toplu silme başarısız', error);
  }
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getString(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    await removeKey(key);
    return fallback;
  }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  await setString(key, JSON.stringify(value));
}

// ─────────────────────────────────────────────────────────────
//  Misafir modu bayrağı — şartname: AsyncStorage'a isGuest = 'true'
// ─────────────────────────────────────────────────────────────
export async function getIsGuest(): Promise<boolean> {
  return (await getString(STORAGE_KEYS.isGuest)) === 'true';
}

export async function setIsGuest(isGuest: boolean): Promise<void> {
  if (isGuest) {
    await setString(STORAGE_KEYS.isGuest, 'true');
  } else {
    await removeKey(STORAGE_KEYS.isGuest);
  }
}

/** Cihazda yerel kimlik üretir (misafir kayıtları için; güvenlik amaçlı değildir). */
export function createLocalId(prefix = 'local'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
