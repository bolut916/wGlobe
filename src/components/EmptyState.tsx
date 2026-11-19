import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';

export function EmptyState({ icon: Icon, title, message }: { icon: LucideIcon; title: string; message: string }) {
  return (
    <View style={styles.container} accessible accessibilityLabel={`${title}. ${message}`}>
      <View style={styles.iconWrap}>
        <Icon size={22} color={COLORS.brass} strokeWidth={1.8} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.borderBrass,
    backgroundColor: COLORS.brassMuted,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

export default EmptyState;
