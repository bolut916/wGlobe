/** Giriş ve kayıt ekranlarının paylaştığı stiller */
import { StyleSheet } from 'react-native';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';

export const authStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
    gap: SPACING.xl,
  },
  header: {
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  overline: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
  },
  title: {
    ...TYPOGRAPHY.title,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADII.md,
    backgroundColor: 'rgba(242, 201, 76, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.3)',
  },
  bannerError: {
    backgroundColor: COLORS.errorMuted,
    borderColor: 'rgba(235, 87, 87, 0.35)',
  },
  bannerText: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  form: {
    gap: SPACING.lg,
  },
  actions: {
    gap: SPACING.sm,
    marginTop: 'auto',
  },
  link: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  linkAccent: {
    color: COLORS.brass,
    fontWeight: '600',
  },
  linkMuted: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    color: COLORS.textTertiary,
  },
});
