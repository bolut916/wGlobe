/**
 * Üye ol ekranı.
 *  - Şifre gücü göstergesi: 4 segment, her biri opacity + scaleX ile dolar (180 ms, 40 ms stagger)
 *  - Misafirse: verilerinin taşınacağı açıkça söylenir (güven)
 *  - E-posta doğrulaması gerekiyorsa form, başarı paneline çapraz geçer
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronLeft, CircleAlert, CloudUpload, KeyRound, Mail, MailCheck } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authStyles } from '@/components/auth/authStyles';
import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { IconButton } from '@/components/IconButton';
import { PressableScale } from '@/components/PressableScale';
import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { useAuth } from '@/context/AuthContext';
import { useUserData } from '@/context/UserDataContext';
import { easeStandard, enterUp, fadeIn, fadeOut } from '@/lib/animations';
import { PASSWORD_STRENGTH_LABELS, getPasswordStrength, registerSchema, validateForm } from '@/lib/validation';
import type { FieldErrors } from '@/types';

const STRENGTH_COLORS = [COLORS.border, COLORS.error, COLORS.warning, COLORS.brassLight, COLORS.success] as const;

function StrengthSegment({ index, strength }: { index: number; strength: number }) {
  const filled = strength > index;
  const color = STRENGTH_COLORS[strength] ?? COLORS.border;
  const style = useAnimatedStyle(() => ({
    opacity: withDelay(index * 40, withTiming(filled ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard })),
    transform: [{ scaleX: withDelay(index * 40, withTiming(filled ? 1 : 0.3, { duration: DURATION.toggle, easing: easeStandard })) }],
  }));
  return (
    <View style={styles.segmentTrack}>
      <Animated.View style={[styles.segmentFill, { backgroundColor: color }, style]} />
    </View>
  );
}

export default function RegisterScreen() {
  const { signUp, isGuest, isCloudAvailable } = useAuth();
  const { favorites, visits } = useUserData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  const strength = getPasswordStrength(password);

  const clearFieldError = (field: string) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (formError) setFormError(null);
  };

  const handleSubmit = async () => {
    const result = validateForm(registerSchema, { email, password, confirmPassword });
    if (!result.success) {
      setErrors(result.errors);
      setShakeKey((key) => key + 1);
      return;
    }
    setErrors({});
    setFormError(null);
    setIsSubmitting(true);
    try {
      const { needsEmailConfirmation } = await signUp(result.data.email, result.data.password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (needsEmailConfirmation) {
        setPendingEmail(result.data.email);
      } else {
        router.replace('/(tabs)/globe');
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Kayıt tamamlanamadı.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'));

  if (pendingEmail) {
    return (
      <SafeAreaView style={authStyles.root} edges={['top', 'bottom']}>
        <View style={styles.successWrap}>
          <Animated.View entering={enterUp(0)} style={styles.successIcon}>
            <MailCheck size={32} color={COLORS.brass} />
          </Animated.View>
          <Animated.Text entering={enterUp(1)} style={authStyles.title} accessibilityRole="header">
            E-postanı kontrol et
          </Animated.Text>
          <Animated.Text entering={enterUp(2)} style={[authStyles.subtitle, styles.center]}>
            <Text style={styles.emailStrong}>{pendingEmail}</Text> adresine bir doğrulama bağlantısı gönderdik.
            Bağlantıya dokunduktan sonra giriş yapabilirsin.
          </Animated.Text>
          <Animated.View entering={enterUp(3)} style={styles.successActions}>
            <Button label="Giriş Ekranına Git" onPress={() => router.replace('/(auth)/login')} />
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={authStyles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={authStyles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={authStyles.scroll} keyboardShouldPersistTaps="handled">
          <IconButton icon={ChevronLeft} onPress={goBack} accessibilityLabel="Geri" />

          <Animated.View entering={enterUp(0)} style={authStyles.header}>
            <Text style={authStyles.overline}>YOLCULUĞUNU KAYDET</Text>
            <Text style={authStyles.title} accessibilityRole="header">
              Üye Ol
            </Text>
            <Text style={authStyles.subtitle}>Favorilerin ve pasaport damgaların tüm cihazlarında seninle olsun.</Text>
          </Animated.View>

          {isGuest ? (
            <Animated.View entering={enterUp(1)} style={styles.syncNote}>
              <CloudUpload size={18} color={COLORS.brass} />
              <Text style={styles.syncText}>
                Misafir verilerin ({favorites.length} favori, {visits.length} damga) yeni hesabına otomatik taşınacak.
              </Text>
            </Animated.View>
          ) : null}

          {!isCloudAvailable ? (
            <Animated.View entering={fadeIn()} style={authStyles.banner}>
              <CircleAlert size={18} color={COLORS.warning} />
              <Text style={authStyles.bannerText}>Bulut hesabı şu anda yapılandırılmadı. Misafir olarak devam edebilirsin.</Text>
            </Animated.View>
          ) : null}

          {formError ? (
            <Animated.View
              entering={fadeIn()}
              exiting={fadeOut()}
              style={[authStyles.banner, authStyles.bannerError]}
              accessibilityLiveRegion="assertive"
            >
              <CircleAlert size={18} color={COLORS.error} />
              <Text style={authStyles.bannerText}>{formError}</Text>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(2)} style={authStyles.form}>
            <FormField
              label="E-POSTA"
              icon={Mail}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                clearFieldError('email');
              }}
              error={errors.email}
              shakeKey={shakeKey}
              placeholder="ad@ornek.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
            />
            <View style={styles.passwordGroup}>
              <FormField
                ref={passwordRef}
                label="ŞİFRE"
                icon={KeyRound}
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  clearFieldError('password');
                }}
                error={errors.password}
                shakeKey={shakeKey}
                placeholder="En az 8 karakter"
                secureTextEntry
                secureToggle
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                submitBehavior="submit"
              />
              <View style={styles.strengthRow} accessible accessibilityLabel={`Şifre gücü: ${PASSWORD_STRENGTH_LABELS[strength] || 'yok'}`}>
                <View style={styles.segments}>
                  {[0, 1, 2, 3].map((index) => (
                    <StrengthSegment key={index} index={index} strength={strength} />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[strength] }]}>{PASSWORD_STRENGTH_LABELS[strength]}</Text>
              </View>
            </View>
            <FormField
              ref={confirmRef}
              label="ŞİFRE (TEKRAR)"
              icon={KeyRound}
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                clearFieldError('confirmPassword');
              }}
              error={errors.confirmPassword}
              shakeKey={shakeKey}
              placeholder="Şifreni tekrar gir"
              secureTextEntry
              secureToggle
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
          </Animated.View>

          <Animated.View entering={enterUp(3)} style={authStyles.actions}>
            <Button label="Hesap Oluştur" onPress={handleSubmit} loading={isSubmitting} disabled={!isCloudAvailable} />
            <PressableScale onPress={() => router.replace('/(auth)/login')} style={authStyles.link} accessibilityRole="link">
              <Text style={authStyles.linkText}>
                Zaten hesabın var mı? <Text style={authStyles.linkAccent}>Giriş yap</Text>
              </Text>
            </PressableScale>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  syncNote: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'flex-start',
    padding: SPACING.md,
    borderRadius: RADII.md,
    backgroundColor: COLORS.brassMuted,
    borderWidth: 1,
    borderColor: COLORS.borderBrass,
  },
  syncText: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  passwordGroup: {
    gap: SPACING.sm,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  segments: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  segmentTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.surfaceElevated,
    overflow: 'hidden',
  },
  segmentFill: {
    flex: 1,
    borderRadius: 2,
    transformOrigin: 'left',
  },
  strengthLabel: {
    ...TYPOGRAPHY.overline,
    minWidth: 48,
    textAlign: 'right',
  },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.lg,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brassMuted,
    borderWidth: 1,
    borderColor: COLORS.borderBrass,
  },
  center: {
    textAlign: 'center',
  },
  emailStrong: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  successActions: {
    alignSelf: 'stretch',
    marginTop: SPACING.lg,
  },
});
