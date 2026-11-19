/**
 * Ruh hâli kürasyon kartı. Şehir çipine dokunmak = o şehre ışınlanmak.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { CloudRain, Coffee, MoonStar, Sunset, TreePalm, Waves, type LucideIcon } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { countryCodeToFlag } from '@/lib/flags';
import type { City, MoodCollection } from '@/types';

import { PressableScale } from './PressableScale';

const MOOD_ICONS: Record<MoodCollection['icon'], LucideIcon> = {
  'moon-star': MoonStar,
  'cloud-rain': CloudRain,
  coffee: Coffee,
  palmtree: TreePalm,
  sunset: Sunset,
  waves: Waves,
};

interface MoodCollectionCardProps {
  mood: MoodCollection;
  cities: City[];
  activeCityId?: string | null;
  onSelectCity: (city: City) => void;
  compact?: boolean;
}

export function MoodCollectionCard({ mood, cities, activeCityId, onSelectCity, compact = false }: MoodCollectionCardProps) {
  const Icon = MOOD_ICONS[mood.icon];
  return (
    <View style={styles.card}>
      <LinearGradient colors={mood.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <View style={[styles.iconWrap, { borderColor: mood.accent }]}>
          <Icon size={18} color={mood.accent} strokeWidth={2} />
        </View>
        <View style={styles.headerTexts}>
          <Text style={styles.title}>{mood.title}</Text>
          {!compact ? <Text style={styles.subtitle}>{mood.subtitle}</Text> : null}
        </View>
        <Text style={[styles.count, { color: mood.accent }]}>{cities.length} şehir</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {cities.map((city) => {
          const active = city.id === activeCityId;
          return (
            <PressableScale
              key={city.id}
              onPress={() => onSelectCity(city)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={`${city.name}, ${city.country} radyosunu dinle`}
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && { borderColor: mood.accent, backgroundColor: 'rgba(0,0,0,0.35)' }]}
            >
              <Text style={styles.chipFlag}>{countryCodeToFlag(city.countryCode)}</Text>
              <Text style={styles.chipText}>{city.name}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    paddingVertical: SPACING.lg,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  headerTexts: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 17,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  count: {
    ...TYPOGRAPHY.overline,
  },
  chips: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    minHeight: 40,
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: 'rgba(244, 239, 230, 0.18)',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  chipFlag: {
    fontSize: 15,
  },
  chipText: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
});

export default MoodCollectionCard;
