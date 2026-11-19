import { useEffect, useState } from 'react';

import { isAbortError } from '@/lib/http';
import { fetchWeatherForCity } from '@/services/weatherService';
import type { City, WeatherInfo } from '@/types';

export interface WeatherState {
  data: WeatherInfo | null;
  isLoading: boolean;
  error: string | null;
}

/** Şehir değişince önceki isteği iptal eder; yarış koşulunda eski şehrin verisi görünmez. */
export function useWeather(city: Pick<City, 'id' | 'lat' | 'lng'> | null): WeatherState {
  const [state, setState] = useState<WeatherState>({ data: null, isLoading: false, error: null });

  const cityId = city?.id ?? null;
  const lat = city?.lat;
  const lng = city?.lng;

  useEffect(() => {
    if (cityId === null || lat === undefined || lng === undefined) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ data: previous.data, isLoading: true, error: null }));

    fetchWeatherForCity({ lat, lng }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ data: null, isLoading: false, error: 'Hava durumu alınamadı' });
      });

    return () => controller.abort();
  }, [cityId, lat, lng]);

  return state;
}
