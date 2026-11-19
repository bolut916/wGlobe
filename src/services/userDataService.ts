/**
 * Kullanıcı verisi deposu — favoriler, Seyahat Pasaportu, tema tercihleri.
 *
 * Tek API, iki arka uç:
 *   userId === null  → Misafir: AsyncStorage (cihazda)
 *   userId !== null  → Üye: Supabase (RLS: auth.uid() = user_id)
 *
 * Misafir üye olduğunda `syncGuestDataToCloud` yerel veriyi buluta taşır
 * ("Hesap Oluştur ve Verilerini Eşitle").
 */
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { DEFAULT_THEME_ID, FREE_THEME_IDS, isGlobeThemeId } from '@/constants/themes';
import { createLocalId, getJSON, getString, removeKeys, setJSON, setString } from '@/lib/storage';
import { assertSupabaseConfigured, isSupabaseConfigured, supabase } from '@/lib/supabase';
import type {
  City,
  FavoriteStation,
  FavoriteStationRow,
  GlobeThemeId,
  NewFavoriteStation,
  Profile,
  ProfileRow,
  VisitedCity,
  VisitedCityRow,
} from '@/types';

/** Aynı şehre bu süre içinde tekrar gelinirse yeni pasaport damgası basılmaz */
export const VISIT_DEDUPE_MS = 30 * 60 * 1000;
/** Misafir cihazında tutulacak en fazla ziyaret */
const MAX_LOCAL_VISITS = 200;

// ─────────────────────────────────────────────────────────────
//  Eşleyiciler (snake_case ↔ camelCase)
// ─────────────────────────────────────────────────────────────
function mapFavorite(row: FavoriteStationRow): FavoriteStation {
  return {
    id: row.id,
    userId: row.user_id,
    stationUuid: row.station_uuid,
    stationName: row.station_name,
    streamUrl: row.stream_url,
    cityName: row.city_name,
    countryCode: row.country_code,
    createdAt: row.created_at,
  };
}

function mapVisit(row: VisitedCityRow): VisitedCity {
  return {
    id: row.id,
    userId: row.user_id,
    cityId: row.city_id,
    cityName: row.city_name,
    visitedAt: row.visited_at,
  };
}

function sanitizeThemes(values: unknown): GlobeThemeId[] {
  const list = Array.isArray(values) ? values.filter(isGlobeThemeId) : [];
  return Array.from(new Set<GlobeThemeId>([...FREE_THEME_IDS, ...list]));
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    selectedTheme: isGlobeThemeId(row.selected_theme) ? row.selected_theme : DEFAULT_THEME_ID,
    unlockedThemes: sanitizeThemes(row.unlocked_themes),
    createdAt: row.created_at,
  };
}

function cloudReady(userId: string | null): userId is string {
  return userId !== null && isSupabaseConfigured;
}

// ─────────────────────────────────────────────────────────────
//  Favori istasyonlar
// ─────────────────────────────────────────────────────────────
export async function getFavorites(userId: string | null): Promise<FavoriteStation[]> {
  if (!cloudReady(userId)) {
    return getJSON<FavoriteStation[]>(STORAGE_KEYS.guestFavorites, []);
  }
  const { data, error } = await supabase
    .from('favorite_stations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapFavorite);
}

export async function addFavorite(userId: string | null, input: NewFavoriteStation): Promise<FavoriteStation> {
  if (!input.streamUrl.startsWith('https://')) {
    throw new Error('Yalnızca güvenli (https) yayınlar favorilere eklenebilir.');
  }

  if (!cloudReady(userId)) {
    const current = await getJSON<FavoriteStation[]>(STORAGE_KEYS.guestFavorites, []);
    const existing = current.find((favorite) => favorite.stationUuid === input.stationUuid);
    if (existing) return existing;
    const favorite: FavoriteStation = {
      ...input,
      countryCode: input.countryCode.toUpperCase(),
      id: createLocalId('fav'),
      userId: null,
      createdAt: new Date().toISOString(),
    };
    await setJSON(STORAGE_KEYS.guestFavorites, [favorite, ...current]);
    return favorite;
  }

  const { data, error } = await supabase
    .from('favorite_stations')
    .upsert(
      {
        user_id: userId,
        station_uuid: input.stationUuid,
        station_name: input.stationName,
        stream_url: input.streamUrl,
        city_name: input.cityName,
        country_code: input.countryCode.toUpperCase(),
      },
      { onConflict: 'user_id,station_uuid' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return mapFavorite(data);
}

export async function removeFavorite(userId: string | null, stationUuid: string): Promise<void> {
  if (!cloudReady(userId)) {
    const current = await getJSON<FavoriteStation[]>(STORAGE_KEYS.guestFavorites, []);
    await setJSON(
      STORAGE_KEYS.guestFavorites,
      current.filter((favorite) => favorite.stationUuid !== stationUuid),
    );
    return;
  }
  const { error } = await supabase
    .from('favorite_stations')
    .delete()
    .eq('user_id', userId)
    .eq('station_uuid', stationUuid);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────
//  Seyahat Pasaportu (ziyaret edilen şehirler)
// ─────────────────────────────────────────────────────────────
export async function getVisitedCities(userId: string | null, limit = 100): Promise<VisitedCity[]> {
  if (!cloudReady(userId)) {
    const visits = await getJSON<VisitedCity[]>(STORAGE_KEYS.guestVisited, []);
    return visits.slice(0, limit);
  }
  const { data, error } = await supabase
    .from('visited_cities')
    .select('*')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapVisit);
}

/**
 * Şehir dinlendiğinde damga basar. Aynı şehir VISIT_DEDUPE_MS içinde tekrar
 * dinlenirse `null` döner (pasaport aynı damgayla dolmasın).
 */
export async function recordVisit(
  userId: string | null,
  city: Pick<City, 'id' | 'name'>,
): Promise<VisitedCity | null> {
  const now = Date.now();
  const isDuplicate = (last: VisitedCity | undefined) =>
    last !== undefined && last.cityId === city.id && now - new Date(last.visitedAt).getTime() < VISIT_DEDUPE_MS;

  if (!cloudReady(userId)) {
    const visits = await getJSON<VisitedCity[]>(STORAGE_KEYS.guestVisited, []);
    if (isDuplicate(visits[0])) return null;
    const visit: VisitedCity = {
      id: createLocalId('visit'),
      userId: null,
      cityId: city.id,
      cityName: city.name,
      visitedAt: new Date(now).toISOString(),
    };
    await setJSON(STORAGE_KEYS.guestVisited, [visit, ...visits].slice(0, MAX_LOCAL_VISITS));
    return visit;
  }

  const { data: latest, error: latestError } = await supabase
    .from('visited_cities')
    .select('*')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (latest && isDuplicate(mapVisit(latest))) return null;

  const { data, error } = await supabase
    .from('visited_cities')
    .insert({ user_id: userId, city_id: city.id, city_name: city.name })
    .select('*')
    .single();
  if (error) throw error;
  return mapVisit(data);
}

// ─────────────────────────────────────────────────────────────
//  Profil & temalar
// ─────────────────────────────────────────────────────────────
export interface ThemeState {
  selectedTheme: GlobeThemeId;
  unlockedThemes: GlobeThemeId[];
}

export async function getLocalThemeState(): Promise<ThemeState> {
  const [selectedRaw, unlockedRaw] = await Promise.all([
    getString(STORAGE_KEYS.selectedTheme),
    getJSON<unknown>(STORAGE_KEYS.unlockedThemes, []),
  ]);
  const unlockedThemes = sanitizeThemes(unlockedRaw);
  const selected = isGlobeThemeId(selectedRaw) && unlockedThemes.includes(selectedRaw) ? selectedRaw : DEFAULT_THEME_ID;
  return { selectedTheme: selected, unlockedThemes };
}

async function saveLocalThemeState(state: ThemeState): Promise<void> {
  await Promise.all([
    setString(STORAGE_KEYS.selectedTheme, state.selectedTheme),
    setJSON(STORAGE_KEYS.unlockedThemes, state.unlockedThemes),
  ]);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? mapProfile(data) : null;
}

/** Hem üye hem misafir için tema durumunu döndürür; üyede yerel önbelleği de günceller. */
export async function getThemeState(userId: string | null): Promise<ThemeState> {
  if (!cloudReady(userId)) return getLocalThemeState();
  try {
    const profile = await getProfile(userId);
    if (!profile) return getLocalThemeState();
    const state: ThemeState = { selectedTheme: profile.selectedTheme, unlockedThemes: profile.unlockedThemes };
    await saveLocalThemeState(state);
    return state;
  } catch {
    // Çevrimdışı: son bilinen yerel durum
    return getLocalThemeState();
  }
}

export async function updateSelectedTheme(userId: string | null, themeId: GlobeThemeId): Promise<ThemeState> {
  const local = await getLocalThemeState();
  if (!local.unlockedThemes.includes(themeId)) {
    throw new Error('Bu küre teması henüz açılmadı.');
  }
  const next: ThemeState = { ...local, selectedTheme: themeId };
  // İyimser güncelleme: yerel önce yazılır, küre anında değişir
  await saveLocalThemeState(next);

  if (cloudReady(userId)) {
    const { error } = await supabase.from('profiles').update({ selected_theme: themeId }).eq('id', userId);
    if (error) throw error;
  }
  return next;
}

export async function unlockTheme(userId: string | null, themeId: GlobeThemeId): Promise<ThemeState> {
  const local = await getLocalThemeState();
  const unlockedThemes = sanitizeThemes([...local.unlockedThemes, themeId]);
  const next: ThemeState = { selectedTheme: themeId, unlockedThemes };
  await saveLocalThemeState(next);

  if (cloudReady(userId)) {
    const { error } = await supabase
      .from('profiles')
      .update({ unlocked_themes: unlockedThemes, selected_theme: themeId })
      .eq('id', userId);
    if (error) throw error;
  }
  return next;
}

// ─────────────────────────────────────────────────────────────
//  Misafir → Üye eşitleme
// ─────────────────────────────────────────────────────────────
export interface SyncResult {
  favorites: number;
  visits: number;
  themes: number;
}

export async function syncGuestDataToCloud(userId: string): Promise<SyncResult> {
  assertSupabaseConfigured();

  const [favorites, visits, themeState] = await Promise.all([
    getJSON<FavoriteStation[]>(STORAGE_KEYS.guestFavorites, []),
    getJSON<VisitedCity[]>(STORAGE_KEYS.guestVisited, []),
    getLocalThemeState(),
  ]);

  if (favorites.length > 0) {
    const { error } = await supabase.from('favorite_stations').upsert(
      favorites
        .filter((favorite) => favorite.streamUrl.startsWith('https://'))
        .map((favorite) => ({
          user_id: userId,
          station_uuid: favorite.stationUuid,
          station_name: favorite.stationName,
          stream_url: favorite.streamUrl,
          city_name: favorite.cityName,
          country_code: favorite.countryCode.toUpperCase(),
          created_at: favorite.createdAt,
        })),
      { onConflict: 'user_id,station_uuid', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  if (visits.length > 0) {
    const { error } = await supabase.from('visited_cities').insert(
      visits.map((visit) => ({
        user_id: userId,
        city_id: visit.cityId,
        city_name: visit.cityName,
        visited_at: visit.visitedAt,
      })),
    );
    if (error) throw error;
  }

  // Temalar: bulut ve yerel kümelerin birleşimi — kullanıcı hiçbir açtığı temayı kaybetmez
  const profile = await getProfile(userId);
  const mergedThemes = sanitizeThemes([...(profile?.unlockedThemes ?? []), ...themeState.unlockedThemes]);
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ unlocked_themes: mergedThemes, selected_theme: themeState.selectedTheme })
    .eq('id', userId);
  if (profileError) throw profileError;

  await removeKeys([STORAGE_KEYS.guestFavorites, STORAGE_KEYS.guestVisited]);
  await saveLocalThemeState({ selectedTheme: themeState.selectedTheme, unlockedThemes: mergedThemes });

  return { favorites: favorites.length, visits: visits.length, themes: mergedThemes.length };
}

/** Çıkışta / hesap silmede cihazdaki kullanıcıya özgü veriyi temizler. */
export async function clearLocalUserData(): Promise<void> {
  await removeKeys([
    STORAGE_KEYS.isGuest,
    STORAGE_KEYS.guestFavorites,
    STORAGE_KEYS.guestVisited,
    STORAGE_KEYS.selectedTheme,
    STORAGE_KEYS.unlockedThemes,
    STORAGE_KEYS.lastStationUuid,
  ]);
}

/**
 * Hesabı kalıcı olarak siler (public.delete_user RPC → auth.users satırı,
 * cascade ile tüm tablolar). Ardından yerel oturum kapatılır.
 */
export async function deleteAccount(): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.rpc('delete_user');
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'local' });
  await clearLocalUserData();
}
