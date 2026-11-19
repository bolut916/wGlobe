/**
 * Supabase `auth.storage` adaptörü — expo-secure-store üzerinde parçalı (chunked) depolama.
 *
 * Neden parçalama?
 *  SecureStore, değer başına ~2048 bayttan büyük kayıtlarda iOS'ta uyarı verir,
 *  bazı Android cihazlarda yazmayı reddeder. Supabase oturumu (access + refresh
 *  token + user metadata) bu sınırı rahatça aşar. Bu yüzden değeri UTF-8 bayt
 *  uzunluğuna göre ≤ 1800 baytlık parçalara bölüyoruz:
 *
 *    <anahtar>.meta  → parça sayısı ("3")
 *    <anahtar>.0     → 1. parça
 *    <anahtar>.1     → 2. parça
 *    …
 *
 *  - Parçalar önce, meta en son yazılır: yazma yarıda kalırsa eski meta geçerli
 *    kalır ya da okuma eksik parçayı fark edip kaydı temizler (bozuk oturum yerine
 *    temiz çıkış).
 *  - Aynı anahtar üzerindeki işlemler sıraya alınır; token yenilemesi sırasında
 *    art arda gelen setItem çağrıları birbirinin parçalarını ezmez.
 *  - keychainAccessible = AFTER_FIRST_UNLOCK: ekran kilitliyken arka planda radyo
 *    çalarken token yenilemesi yapılabilmesi için gerekli.
 *
 * Web'de SecureStore yoktur; orada localStorage'a düşülür.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { SECURE_STORE_PREFIX } from '@/constants/storageKeys';

/** 2048 bayt sınırının güvenli tarafında kalan parça boyutu */
const MAX_CHUNK_BYTES = 1800;
/** Patolojik büyüklükteki değerlere karşı üst sınır (~180 KB) */
const MAX_CHUNKS = 100;

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** SecureStore anahtarları yalnızca [A-Za-z0-9._-] içerebilir */
function toSafeKey(key: string): string {
  return `${SECURE_STORE_PREFIX}.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

const metaKey = (base: string) => `${base}.meta`;
const chunkKey = (base: string, index: number) => `${base}.${index}`;

function utf8ByteLength(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Değeri UTF-8 bayt uzunluğuna göre böler. `for…of` kod noktaları üzerinde
 * yürüdüğü için surrogate çiftleri (emoji vb.) asla ortadan bölünmez.
 */
export function splitIntoChunks(value: string, maxBytes: number = MAX_CHUNK_BYTES): string[] {
  if (value.length === 0) return [''];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of value) {
    const bytes = utf8ByteLength(char.codePointAt(0) ?? 0);
    if (currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ─────────────────────────────────────────────────────────────
//  Anahtar başına işlem kuyruğu
// ─────────────────────────────────────────────────────────────
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

// ─────────────────────────────────────────────────────────────
//  Web yedeği
// ─────────────────────────────────────────────────────────────
function getWebStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    // Gizli sekme veya erişim engeli
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//  Native uygulama
// ─────────────────────────────────────────────────────────────
async function readChunkCount(base: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(metaKey(base), SECURE_OPTIONS);
  if (raw == null) return 0;
  const count = Number.parseInt(raw, 10);
  return Number.isFinite(count) && count > 0 && count <= MAX_CHUNKS ? count : 0;
}

async function deleteChunks(base: string, from: number, to: number): Promise<void> {
  const deletions: Promise<void>[] = [];
  for (let index = from; index < to; index += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(base, index), SECURE_OPTIONS).catch(() => undefined));
  }
  await Promise.all(deletions);
}

async function nativeGetItem(key: string): Promise<string | null> {
  const base = toSafeKey(key);
  const count = await readChunkCount(base);
  if (count === 0) return null;

  const parts = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(base, index), SECURE_OPTIONS)),
  );

  if (parts.some((part) => part == null)) {
    // Eksik parça: kayıt bozulmuş. Yarım oturumla devam etmek yerine temizle.
    await nativeRemoveItem(key, count);
    return null;
  }
  return parts.join('');
}

async function nativeSetItem(key: string, value: string): Promise<void> {
  const base = toSafeKey(key);
  const chunks = splitIntoChunks(value);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`secureStorage: "${key}" değeri çok büyük (${chunks.length} parça)`);
  }

  const previousCount = await readChunkCount(base);

  // 1) Parçalar
  for (let index = 0; index < chunks.length; index += 1) {
    await SecureStore.setItemAsync(chunkKey(base, index), chunks[index] ?? '', SECURE_OPTIONS);
  }
  // 2) Meta (commit noktası)
  await SecureStore.setItemAsync(metaKey(base), String(chunks.length), SECURE_OPTIONS);
  // 3) Eski değerden artan parçaları temizle
  if (previousCount > chunks.length) {
    await deleteChunks(base, chunks.length, previousCount);
  }
}

async function nativeRemoveItem(key: string, knownCount?: number): Promise<void> {
  const base = toSafeKey(key);
  const count = knownCount ?? (await readChunkCount(base));
  await SecureStore.deleteItemAsync(metaKey(base), SECURE_OPTIONS).catch(() => undefined);
  // Meta okunamadıysa bile olası artıkları temizlemek için en az 1 parça sil
  await deleteChunks(base, 0, Math.max(count, 1));
}

// ─────────────────────────────────────────────────────────────
//  Supabase'in beklediği arayüz
// ─────────────────────────────────────────────────────────────
export interface SupportedStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const isWeb = Platform.OS === 'web';

export const secureStorage: SupportedStorage = {
  getItem(key) {
    if (isWeb) {
      return Promise.resolve(getWebStorage()?.getItem(key) ?? null);
    }
    return enqueue(key, async () => {
      try {
        return await nativeGetItem(key);
      } catch (error) {
        console.warn('[secureStorage] getItem başarısız', error);
        return null;
      }
    });
  },

  setItem(key, value) {
    if (isWeb) {
      getWebStorage()?.setItem(key, value);
      return Promise.resolve();
    }
    return enqueue(key, () => nativeSetItem(key, value));
  },

  removeItem(key) {
    if (isWeb) {
      getWebStorage()?.removeItem(key);
      return Promise.resolve();
    }
    return enqueue(key, async () => {
      try {
        await nativeRemoveItem(key);
      } catch (error) {
        console.warn('[secureStorage] removeItem başarısız', error);
      }
    });
  },
};

export default secureStorage;
