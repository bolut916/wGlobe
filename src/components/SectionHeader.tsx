import { StyleSheet, Text, View } from 'react-native';

import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/colors';

export function SectionHeader({ title, caption, trailing }: { title: string; caption?: string; trailing?: string }) {
  return (
    <View style={styles.container}>
      <View style={styles.texts}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...TYPOGRAPHY.heading,
    color: COLORS.textPrimary,
  },
  caption: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  trailing: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
  },
});

export default SectionHeader;
