/**
 * Keşfet — ruh hâline göre kürasyonlar + Seyahat Pasaportu.
 * Koreografi: başlık (hero) → 3 vitrin kartı (70 ms stagger) → ikincil
 * atmosferler → pasaport. Bir şehre dokunmak küre sekmesine ışınlar.
 */
import { router } from 'expo-router';
import { Stamp } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { MoodCollectionCard } from '@/components/MoodCollectionCard';
import { PassportStamp } from '@/components/PassportStamp';
import { SectionHeader } from '@/components/SectionHeader';
import { getCitiesByVibe, getCityById } from '@/constants/cities';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { STAGGER } from '@/constants/motion';
import { FEATURED_MOOD_IDS, MOOD_COLLECTIONS } from '@/constants/moods';
import { useGlobeAudio } from '@/context/GlobeAudioContext';
import { useUserData } from '@/context/UserDataContext';
import { enterUp } from '@/lib/animations';
import type { City } from '@/types';

const PASSPORT_LIMIT = 24;

export default function ExploreScreen() {
  const { activeCity, selectCity } = useGlobeAudio();
  const { visits } = useUserData();

  const featured = useMemo(() => MOOD_COLLECTIONS.filter((mood) => FEATURED_MOOD_IDS.includes(mood.id)), []);
  const others = useMemo(() => MOOD_COLLECTIONS.filter((mood) => !FEATURED_MOOD_IDS.includes(mood.id)), []);
  const uniqueCityCount = useMemo(() => new Set(visits.map((visit) => visit.cityId)).size, [visits]);

  const openCity = (city: City) => {
    selectCity(city);
    router.navigate('/(tabs)/globe');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enterUp(0)} style={styles.header}>
          <Text style={styles.overline}>KEŞFET</Text>
          <Text style={styles.title} accessibilityRole="header">
            Bu akşam nasıl hissediyorsun?
          </Text>
        </Animated.View>

        <View style={styles.section}>
          {featured.map((mood, index) => (
            <Animated.View key={mood.id} entering={enterUp(index, { base: STAGGER.heroToSecondary, step: STAGGER.card })}>
              <MoodCollectionCard
                mood={mood}
                cities={getCitiesByVibe(mood.vibeTag)}
                activeCityId={activeCity?.id}
                onSelectCity={openCity}
              />
            </Animated.View>
          ))}
        </View>

        <View style={styles.section}>
          <Animated.View entering={enterUp(3, { base: STAGGER.heroToSecondary, step: STAGGER.card })}>
            <SectionHeader title="Daha fazla atmosfer" />
          </Animated.View>
          {others.map((mood, index) => (
            <Animated.View key={mood.id} entering={enterUp(index + 4, { base: STAGGER.heroToSecondary, step: STAGGER.card })}>
              <MoodCollectionCard
                mood={mood}
                cities={getCitiesByVibe(mood.vibeTag)}
                activeCityId={activeCity?.id}
                onSelectCity={openCity}
                compact
              />
            </Animated.View>
          ))}
        </View>

        <View style={styles.section}>
          <SectionHeader
            title="Seyahat Pasaportu"
            caption="Dinlediğin her şehir pasaportuna damga basar."
            trailing={visits.length > 0 ? `${uniqueCityCount} / 25 ŞEHİR` : undefined}
          />
          {visits.length === 0 ? (
            <EmptyState
              icon={Stamp}
              title="Pasaportun henüz boş"
              message="Küreden bir şehir seç ve radyosunu dinle — ilk damgan anında basılsın."
            />
          ) : (
            <View style={styles.stamps}>
              {visits.slice(0, PASSPORT_LIMIT).map((visit, index) => {
                const city = getCityById(visit.cityId);
                return (
                  <Animated.View key={visit.id} entering={enterUp(index, { step: STAGGER.list })} style={styles.stampCell}>
                    <PassportStamp visit={visit} index={index} onPress={city ? () => openCity(city) : undefined} />
                  </Animated.View>
                );
              })}
            </View>
          )}
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
    gap: SPACING.xxl,
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
  section: {
    gap: SPACING.md,
  },
  stamps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  stampCell: {
    width: '47%',
    flexGrow: 1,
  },
});
