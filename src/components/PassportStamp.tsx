/**
 * Seyahat Pasaportu damgası. Her damga indeksine göre −3°…+3° arası hafifçe
 * eğik — gerçek bir pasaportta hiçbir mühür düz basılmaz; bu küçük kusur
 * kartlara el yapımı bir sıcaklık verir. (Eğim sabit bir transform: layout yok.)
 */
import { StyleSheet, Text, View } from 'react-native';

import { getCityById } from '@/constants/cities';
import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { countryCodeToFlag } from '@/lib/flags';
import { formatPassportStamp } from '@/lib/time';
import type { VisitedCity } from '@/types';

import { PressableScale } from './PressableScale';

const TILTS = [-2.5, 1.5, -1, 2.5, -1.8, 0.8];

export function PassportStamp({ visit, index, onPress }: { visit: VisitedCity; index: number; onPress?: () => void }) {
  const city = getCityById(visit.cityId);
  const tilt = TILTS[index % TILTS.length] ?? 0;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={`${visit.cityName} damgası, ${formatPassportStamp(visit.visitedAt)}`}
      style={[styles.stamp, { transform: [{ rotate: `${tilt}deg` }] }]}
    >
      <View style={styles.inner}>
        <Text style={styles.flag}>{city ? countryCodeToFlag(city.countryCode) : '🌐'}</Text>
        <Text style={styles.city} numberOfLines={1}>
          {visit.cityName.toLocaleUpperCase('tr-TR')}
        </Text>
        <Text style={styles.country} numberOfLines={1}>
          {city?.country ?? ''}
        </Text>
        <View style={styles.rule} />
        <Text style={styles.date}>{formatPassportStamp(visit.visitedAt)}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  stamp: {
    flex: 1,
    minWidth: 140,
    padding: 4,
    borderRadius: RADII.md,
    borderWidth: 1.5,
    borderColor: COLORS.borderBrass,
  },
  inner: {
    borderRadius: RADII.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.borderBrass,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.brassMuted,
  },
  flag: {
    fontSize: 22,
    marginBottom: 2,
  },
  city: {
    ...TYPOGRAPHY.overline,
    fontSize: 13,
    color: COLORS.brassLight,
  },
  country: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  rule: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderBrass,
    marginVertical: SPACING.xs,
  },
  date: {
    ...TYPOGRAPHY.mono,
    fontSize: 12,
    color: COLORS.textPrimary,
  },
});

export default PassportStamp;
