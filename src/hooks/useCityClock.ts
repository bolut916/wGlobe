import { useEffect, useState } from 'react';

import { formatCityDate, formatCityTime, formatRelativeToDevice, formatUtcOffset, getDayPhase, type DayPhase } from '@/lib/time';

export interface CityClock {
  time: string;
  date: string;
  utcOffset: string;
  relative: string;
  phase: DayPhase;
}

function read(timeZone: string): CityClock {
  const now = new Date();
  return {
    time: formatCityTime(timeZone, now, true),
    date: formatCityDate(timeZone, now),
    utcOffset: formatUtcOffset(timeZone, now),
    relative: formatRelativeToDevice(timeZone, now),
    phase: getDayPhase(timeZone, now),
  };
}

/**
 * Saniye sınırına HİZALI canlı saat. Basit setInterval(1000) saniyenin ortasında
 * tetiklenip gerçek saatten ~0.5 sn geri kalabilir; burada ilk tik bir sonraki
 * tam saniyeye zamanlanır, sonra her saniye.
 */
export function useCityClock(timeZone: string | null | undefined): CityClock | null {
  const [clock, setClock] = useState<CityClock | null>(() => (timeZone ? read(timeZone) : null));

  useEffect(() => {
    if (!timeZone) {
      setClock(null);
      return;
    }
    setClock(read(timeZone));
    let interval: ReturnType<typeof setInterval> | null = null;
    const alignTimeout = setTimeout(() => {
      setClock(read(timeZone));
      interval = setInterval(() => setClock(read(timeZone)), 1000);
    }, 1000 - (Date.now() % 1000));

    return () => {
      clearTimeout(alignTimeout);
      if (interval) clearInterval(interval);
    };
  }, [timeZone]);

  return clock;
}
