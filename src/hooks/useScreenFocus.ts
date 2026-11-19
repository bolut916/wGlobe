import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * Sekme ekranı görünür mü? Sekmeler arka planda bağlı kalır; GL render
 * döngüsünü görünmeyen sekmede durdurmak için kullanılır.
 */
export function useScreenFocus(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
