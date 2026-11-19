/**
 * Kullanıcı verisi: favoriler, Seyahat Pasaportu, küre teması.
 * Tüm yazma işlemleri İYİMSER (optimistic): UI anında güncellenir, sunucu
 * hatasında eski duruma geri dönülür. Kalp ikonuna dokunmak ile kalbin
 * dolması arasında ağ gecikmesi hissedilmemeli.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DEFAULT_THEME_ID, FREE_THEME_IDS } from '@/constants/themes';
import * as userData from '@/services/userDataService';
import type { City, FavoriteStation, GlobeThemeId, RadioStation, VisitedCity } from '@/types';

import { useAuth } from './AuthContext';

interface UserDataContextValue {
  isLoading: boolean;
  favorites: FavoriteStation[];
  visits: VisitedCity[];
  selectedTheme: GlobeThemeId;
  unlockedThemes: GlobeThemeId[];
  isFavorite: (stationUuid: string) => boolean;
  toggleFavorite: (station: RadioStation, city: City) => Promise<boolean>;
  removeFavorite: (stationUuid: string) => Promise<void>;
  recordVisit: (city: City) => Promise<void>;
  selectTheme: (themeId: GlobeThemeId) => Promise<void>;
  unlockTheme: (themeId: GlobeThemeId) => Promise<void>;
  refresh: () => Promise<void>;
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { mode, userId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [favorites, setFavorites] = useState<FavoriteStation[]>([]);
  const [visits, setVisits] = useState<VisitedCity[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<GlobeThemeId>(DEFAULT_THEME_ID);
  const [unlockedThemes, setUnlockedThemes] = useState<GlobeThemeId[]>([...FREE_THEME_IDS]);

  // Hızlı okuma ve yarış koşullarına karşı güncel değerlerin aynası
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const loadTokenRef = useRef(0);

  const effectiveUserId = mode === 'authenticated' ? userId : null;

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setIsLoading(true);
    try {
      const [nextFavorites, nextVisits, themeState] = await Promise.all([
        userData.getFavorites(effectiveUserId).catch(() => [] as FavoriteStation[]),
        userData.getVisitedCities(effectiveUserId).catch(() => [] as VisitedCity[]),
        userData.getThemeState(effectiveUserId),
      ]);
      if (token !== loadTokenRef.current) return;
      setFavorites(nextFavorites);
      setVisits(nextVisits);
      setSelectedTheme(themeState.selectedTheme);
      setUnlockedThemes(themeState.unlockedThemes);
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => {
    if (mode === 'loading') return;
    void load();
  }, [mode, load]);

  const isFavorite = useCallback(
    (stationUuid: string) => favorites.some((favorite) => favorite.stationUuid === stationUuid),
    [favorites],
  );

  const removeFavorite = useCallback(
    async (stationUuid: string) => {
      const previous = favoritesRef.current;
      setFavorites(previous.filter((favorite) => favorite.stationUuid !== stationUuid));
      try {
        await userData.removeFavorite(effectiveUserId, stationUuid);
      } catch (error) {
        setFavorites(previous);
        throw error;
      }
    },
    [effectiveUserId],
  );

  /** Favori durumunu değiştirir; dönen değer yeni durumdur (true = favoride). */
  const toggleFavorite = useCallback(
    async (station: RadioStation, city: City): Promise<boolean> => {
      const exists = favoritesRef.current.some((favorite) => favorite.stationUuid === station.uuid);
      if (exists) {
        await removeFavorite(station.uuid);
        return false;
      }
      const previous = favoritesRef.current;
      const optimistic: FavoriteStation = {
        id: `pending-${station.uuid}`,
        userId: effectiveUserId,
        stationUuid: station.uuid,
        stationName: station.name,
        streamUrl: station.streamUrl,
        cityName: city.name,
        countryCode: station.isFallback ? city.countryCode : station.countryCode || city.countryCode,
        createdAt: new Date().toISOString(),
      };
      setFavorites([optimistic, ...previous]);
      try {
        const saved = await userData.addFavorite(effectiveUserId, {
          stationUuid: optimistic.stationUuid,
          stationName: optimistic.stationName,
          streamUrl: optimistic.streamUrl,
          cityName: optimistic.cityName,
          countryCode: optimistic.countryCode,
        });
        setFavorites((current) => current.map((favorite) => (favorite.id === optimistic.id ? saved : favorite)));
        return true;
      } catch (error) {
        setFavorites(previous);
        throw error;
      }
    },
    [effectiveUserId, removeFavorite],
  );

  const recordVisit = useCallback(
    async (city: City) => {
      try {
        const visit = await userData.recordVisit(effectiveUserId, city);
        if (visit) setVisits((current) => [visit, ...current]);
      } catch (error) {
        if (__DEV__) console.warn('[userData] ziyaret kaydedilemedi', error);
      }
    },
    [effectiveUserId],
  );

  const selectTheme = useCallback(
    async (themeId: GlobeThemeId) => {
      const previous = selectedTheme;
      setSelectedTheme(themeId);
      try {
        const state = await userData.updateSelectedTheme(effectiveUserId, themeId);
        setUnlockedThemes(state.unlockedThemes);
      } catch (error) {
        setSelectedTheme(previous);
        throw error;
      }
    },
    [effectiveUserId, selectedTheme],
  );

  const unlockTheme = useCallback(
    async (themeId: GlobeThemeId) => {
      const previousSelected = selectedTheme;
      const previousUnlocked = unlockedThemes;
      setUnlockedThemes(Array.from(new Set([...previousUnlocked, themeId])));
      setSelectedTheme(themeId);
      try {
        const state = await userData.unlockTheme(effectiveUserId, themeId);
        setUnlockedThemes(state.unlockedThemes);
        setSelectedTheme(state.selectedTheme);
      } catch (error) {
        setSelectedTheme(previousSelected);
        setUnlockedThemes(previousUnlocked);
        throw error;
      }
    },
    [effectiveUserId, selectedTheme, unlockedThemes],
  );

  const value = useMemo<UserDataContextValue>(
    () => ({
      isLoading,
      favorites,
      visits,
      selectedTheme,
      unlockedThemes,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      recordVisit,
      selectTheme,
      unlockTheme,
      refresh: load,
    }),
    [
      isLoading,
      favorites,
      visits,
      selectedTheme,
      unlockedThemes,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      recordVisit,
      selectTheme,
      unlockTheme,
      load,
    ],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData(): UserDataContextValue {
  const context = useContext(UserDataContext);
  if (!context) throw new Error('useUserData, UserDataProvider içinde kullanılmalı');
  return context;
}
