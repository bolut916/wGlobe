/**
 * Koleksiyon — küre materyalleri.
 *
 * Dokun → önizle: üstteki canlı küre, shader renklerini 700 ms'de yeni temaya
 * morflar (geometri değişmez, "malzeme" değişir). Kilitli tema da önizlenebilir;
 * kullanıcı satın almadan önce sonucu görür. "Kilidi Aç" tek dokunuşla açar
 * ve uygular — başarı haptiği + kilit rozeti yayla kaybolur.
 */
import * as Haptics from 'expo-haptics';
import { Check, LockOpen, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { InteractiveGlobe } from '@/components/InteractiveGlobe';
import { ThemeCard } from '@/components/ThemeCard';
import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION, STAGGER } from '@/constants/motion';
import { GLOBE_THEMES, THEME_ORDER } from '@/constants/themes';
import { useUserData } from '@/context/UserDataContext';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { enterUp, fadeIn } from '@/lib/animations';
import type { GlobeThemeId } from '@/types';

export default function ThemesScreen() {
  const focused = useScreenFocus();
  const { selectedTheme, unlockedThemes, selectTheme, unlockTheme } = useUserData();
  const [previewId, setPreviewId] = useState<GlobeThemeId>(selectedTheme);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Sekmeye dönünce önizleme seçili temaya geri döner
  useEffect(() => {
    if (focused) setPreviewId(selectedTheme);
  }, [focused, selectedTheme]);

  const preview = GLOBE_THEMES[previewId];
  const isUnlocked = unlockedThemes.includes(previewId);
  const isSelected = selectedTheme === previewId;

  const handleAction = async () => {
    setIsWorking(true);
    setMessage(null);
    try {
      if (!isUnlocked) {
        await unlockTheme(previewId);
        setMessage(`${preview.name} koleksiyonuna eklendi ve uygulandı.`);
      } else {
        await selectTheme(previewId);
        setMessage(`${preview.name} küreye uygulandı.`);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch {
      setMessage('Tema kaydedilemedi. Lütfen tekrar dene.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enterUp(0)} style={styles.header}>
          <Text style={styles.overline}>KOLEKSİYON</Text>
          <Text style={styles.title} accessibilityRole="header">
            Küre Materyalleri
          </Text>
        </Animated.View>

        <Animated.View entering={fadeIn(STAGGER.heroToSecondary / 2, DURATION.modal)} style={styles.previewCard}>
          <View style={styles.previewGlobe}>
            <InteractiveGlobe themeId={previewId} interactive={false} autoRotate showMarkers paused={!focused} cameraDistance={3.1} />
          </View>
          <View style={styles.previewFooter}>
            <Animated.View key={previewId} entering={fadeIn(0, DURATION.toggle)} style={styles.previewTexts}>
              <Text style={styles.previewName}>{preview.name}</Text>
              <Text style={styles.previewState}>
                {isSelected ? 'Şu an kullanılıyor' : isUnlocked ? 'Koleksiyonunda' : 'Önizleme · Kilitli'}
              </Text>
            </Animated.View>
            <Button
              label={isSelected ? 'Kullanılıyor' : isUnlocked ? 'Uygula' : 'Kilidi Aç'}
              icon={isSelected ? Check : isUnlocked ? Sparkles : LockOpen}
              variant={isSelected ? 'secondary' : 'primary'}
              onPress={handleAction}
              loading={isWorking}
              disabled={isSelected}
              style={styles.actionButton}
            />
          </View>
          {message ? (
            <Animated.Text key={message} entering={fadeIn(0, DURATION.toggle)} style={styles.message} accessibilityLiveRegion="polite">
              {message}
            </Animated.Text>
          ) : null}
        </Animated.View>

        <View style={styles.list}>
          {THEME_ORDER.map((id, index) => (
            <Animated.View key={id} entering={enterUp(index, { base: STAGGER.heroToSecondary, step: STAGGER.card })}>
              <ThemeCard
                theme={GLOBE_THEMES[id]}
                isPreviewing={previewId === id}
                isSelected={selectedTheme === id}
                isUnlocked={unlockedThemes.includes(id)}
                onPress={() => {
                  setPreviewId(id);
                  setMessage(null);
                }}
              />
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.xl,
  },
  header: {
    gap: SPACING.xs,
  },
  overline: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
  },
  title: {
    ...TYPOGRAPHY.title,
    color: COLORS.textPrimary,
  },
  previewCard: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  previewGlobe: {
    height: 280,
  },
  previewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  previewTexts: {
    flex: 1,
    gap: 2,
  },
  previewName: {
    ...TYPOGRAPHY.heading,
    color: COLORS.textPrimary,
  },
  previewState: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  actionButton: {
    paddingHorizontal: SPACING.lg,
  },
  message: {
    ...TYPOGRAPHY.caption,
    color: COLORS.brassLight,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  list: {
    gap: SPACING.md,
  },
});
