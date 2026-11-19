/**
 * Profil — kimlik, eşitleme çağrısı, favoriler, uyku zamanlayıcısı, hesap.
 * Yıkıcı eylemler (hesabı sil) her zaman onay ister ve en altta, kırmızı,
 * diğer eylemlerden boşlukla ayrılmış durur.
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { CloudUpload, Heart, LogOut, Play, Radio, Trash2, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { PressableScale } from '@/components/PressableScale';
import { SectionHeader } from '@/components/SectionHeader';
import { SleepTimerCard } from '@/components/SleepTimerCard';
import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION, STAGGER } from '@/constants/motion';
import { useAuth } from '@/context/AuthContext';
import { useGlobeAudio } from '@/context/GlobeAudioContext';
import { useUserData } from '@/context/UserDataContext';
import { easeStandard, enterUp, fadeOut } from '@/lib/animations';
import { countryCodeToFlag } from '@/lib/flags';
import type { FavoriteStation } from '@/types';

function FavoriteRow({
  favorite,
  isCurrent,
  onPlay,
  onRemove,
}: {
  favorite: FavoriteStation;
  isCurrent: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  return (
    <PressableScale
      onPress={onPlay}
      haptic="light"
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${favorite.stationName}, ${favorite.cityName}. Dinlemek için dokun`}
      style={[styles.favoriteRow, isCurrent && styles.favoriteRowActive]}
    >
      <View style={styles.favoriteIcon}>
        {isCurrent ? <Play size={16} color={COLORS.brass} fill={COLORS.brass} /> : <Radio size={16} color={COLORS.textSecondary} />}
      </View>
      <View style={styles.favoriteTexts}>
        <Text style={styles.favoriteName} numberOfLines={1}>
          {favorite.stationName}
        </Text>
        <Text style={styles.favoriteMeta} numberOfLines={1}>
          {countryCodeToFlag(favorite.countryCode)} {favorite.cityName}
        </Text>
      </View>
      <IconButton
        icon={Heart}
        variant="plain"
        color={COLORS.brass}
        fill={COLORS.brass}
        size={18}
        onPress={onRemove}
        accessibilityLabel={`${favorite.stationName} favorilerden çıkar`}
      />
    </PressableScale>
  );
}

export default function ProfileScreen() {
  const { isGuest, user, signOut, deleteAccount } = useAuth();
  const { favorites, visits, removeFavorite } = useUserData();
  const { playFavorite, currentStation, stop } = useGlobeAudio();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handlePlayFavorite = (favorite: FavoriteStation) => {
    playFavorite(favorite);
    router.navigate('/(tabs)/globe');
  };

  const handleRemove = (favorite: FavoriteStation) => {
    removeFavorite(favorite.stationUuid).catch(() => {
      Alert.alert('Kaldırılamadı', 'Favori şu anda kaldırılamadı. Bağlantını kontrol edip tekrar dene.');
    });
  };

  const handleSignOut = () => {
    Alert.alert(
      isGuest ? 'Misafir modundan çık' : 'Çıkış yap',
      isGuest
        ? 'Favorilerin ve pasaportun bu cihazda saklanmaya devam eder.'
        : 'Bu cihazdaki oturumun kapatılacak. Verilerin hesabında güvende.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: isGuest ? 'Çık' : 'Çıkış Yap',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              stop();
              await signOut();
              router.replace('/(auth)/welcome');
            } finally {
              setIsSigningOut(false);
            }
          },
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Hesabı kalıcı olarak sil',
      'Favorilerin, pasaport damgaların ve açtığın temalar dahil tüm verilerin silinecek. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Hesabı Sil',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              stop();
              await deleteAccount();
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
              router.replace('/(auth)/welcome');
            } catch (error) {
              Alert.alert('Hesap silinemedi', error instanceof Error ? error.message : 'Lütfen tekrar dene.');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  };

  const displayName = isGuest ? 'Misafir Gezgin' : (user?.email ?? 'Gezgin');
  const initial = isGuest ? null : (user?.email?.[0]?.toLocaleUpperCase('tr-TR') ?? null);

  let index = 0;
  const next = () => enterUp(index++, { step: STAGGER.card });

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Kimlik */}
        <Animated.View entering={next()} style={styles.identity}>
          <View style={styles.avatar}>
            {initial ? <Text style={styles.avatarText}>{initial}</Text> : <UserRound size={26} color={COLORS.brass} />}
          </View>
          <View style={styles.identityTexts}>
            <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
              {displayName}
            </Text>
            <Text style={styles.stats}>
              {favorites.length} favori · {visits.length} damga
            </Text>
          </View>
          <View style={[styles.badge, isGuest ? styles.badgeGuest : styles.badgeMember]}>
            <Text style={[styles.badgeText, isGuest ? styles.badgeTextGuest : styles.badgeTextMember]}>
              {isGuest ? 'MİSAFİR' : 'ÜYE'}
            </Text>
          </View>
        </Animated.View>

        {/* Eşitleme çağrısı */}
        {isGuest ? (
          <Animated.View entering={next()} style={styles.syncCard}>
            <View style={styles.syncHeader}>
              <View style={styles.syncIcon}>
                <CloudUpload size={20} color={COLORS.textInverse} />
              </View>
              <View style={styles.syncTexts}>
                <Text style={styles.syncTitle}>Hesap Oluştur ve Verilerini Eşitle</Text>
                <Text style={styles.syncBody}>
                  Favorilerin, pasaport damgaların ve temaların şu an yalnızca bu cihazda. Ücretsiz bir hesapla her
                  yerde seninle olsun.
                </Text>
              </View>
            </View>
            <Button label="Hesap Oluştur" onPress={() => router.push('/(auth)/register')} />
            <PressableScale onPress={() => router.push('/(auth)/login')} style={styles.inlineLink} accessibilityRole="link">
              <Text style={styles.inlineLinkText}>
                Zaten hesabın var mı? <Text style={styles.inlineLinkAccent}>Giriş yap</Text>
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}

        {/* Favoriler */}
        <Animated.View entering={next()} style={styles.section}>
          <SectionHeader title="Favori İstasyonlar" trailing={favorites.length > 0 ? `${favorites.length}` : undefined} />
          {favorites.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="Henüz favorin yok"
              message="Bir şehri dinlerken kalbe dokun; istasyon buraya gelsin."
            />
          ) : (
            <View style={styles.favoritesList}>
              {favorites.map((favorite) => (
                <Animated.View
                  key={favorite.id}
                  layout={LinearTransition.duration(DURATION.card).easing(easeStandard)}
                  exiting={fadeOut(DURATION.toggle)}
                >
                  <FavoriteRow
                    favorite={favorite}
                    isCurrent={currentStation?.uuid === favorite.stationUuid}
                    onPlay={() => handlePlayFavorite(favorite)}
                    onRemove={() => handleRemove(favorite)}
                  />
                </Animated.View>
              ))}
            </View>
          )}
        </Animated.View>

        {/* Uyku zamanlayıcısı */}
        <Animated.View entering={next()}>
          <SleepTimerCard />
        </Animated.View>

        {/* Hesap */}
        <Animated.View entering={next()} style={styles.accountActions}>
          <Button
            label={isGuest ? 'Misafir Modundan Çık' : 'Çıkış Yap'}
            icon={LogOut}
            variant="secondary"
            onPress={handleSignOut}
            loading={isSigningOut}
          />
          {!isGuest ? (
            <Button
              label="Hesabı Sil"
              icon={Trash2}
              variant="danger"
              onPress={handleDeleteAccount}
              loading={isDeleting}
              accessibilityHint="Hesabını ve tüm verilerini kalıcı olarak siler"
              style={styles.deleteButton}
            />
          ) : null}
        </Animated.View>
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brassMuted,
    borderWidth: 1,
    borderColor: COLORS.borderBrass,
  },
  avatarText: {
    ...TYPOGRAPHY.heading,
    color: COLORS.brass,
  },
  identityTexts: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...TYPOGRAPHY.heading,
    color: COLORS.textPrimary,
  },
  stats: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  badgeGuest: {
    borderColor: COLORS.borderStrong,
  },
  badgeMember: {
    borderColor: COLORS.borderBrass,
    backgroundColor: COLORS.brassMuted,
  },
  badgeText: {
    ...TYPOGRAPHY.overline,
    fontSize: 10,
  },
  badgeTextGuest: {
    color: COLORS.textSecondary,
  },
  badgeTextMember: {
    color: COLORS.brass,
  },
  syncCard: {
    padding: SPACING.lg,
    borderRadius: RADII.xl,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderBrass,
    gap: SPACING.lg,
  },
  syncHeader: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  syncIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brass,
  },
  syncTexts: {
    flex: 1,
    gap: SPACING.xs,
  },
  syncTitle: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  syncBody: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
  },
  inlineLink: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLinkText: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  inlineLinkAccent: {
    color: COLORS.brass,
    fontWeight: '600',
  },
  section: {
    gap: SPACING.md,
  },
  favoritesList: {
    gap: SPACING.sm,
  },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  favoriteRowActive: {
    borderColor: COLORS.borderBrass,
  },
  favoriteIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
  },
  favoriteTexts: {
    flex: 1,
    gap: 2,
  },
  favoriteName: {
    ...TYPOGRAPHY.bodyStrong,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  favoriteMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  accountActions: {
    gap: SPACING.md,
  },
  deleteButton: {
    marginTop: SPACING.lg,
  },
});
