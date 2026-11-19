/**
 * Giriş ekranı.
 *  - Doğrulama gönderimde yapılır; hatalı alan sarsılır, mesaj alanın altında belirir.
 *  - Bir alan düzeltilince o alanın hatası anında kalkar (kullanıcı hatayı "kapattığını" görür).
 *  - Sunucu hatası form üstünde tek bir banner olarak gösterilir.
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronLeft, CircleAlert, KeyRound, Mail } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormField } from '@/components/FormField';
import { IconButton } from '@/components/IconButton';
import { PressableScale } from '@/components/PressableScale';
import { authStyles } from '@/components/auth/authStyles';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { enterUp, fadeIn, fadeOut } from '@/lib/animations';
import { loginSchema, validateForm } from '@/lib/validation';
import type { FieldErrors } from '@/types';

export default function LoginScreen() {
  const { signIn, continueAsGuest, isCloudAvailable } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const clearFieldError = (field: string) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    if (formError) setFormError(null);
  };

  const handleSubmit = async () => {
    const result = validateForm(loginSchema, { email, password });
    if (!result.success) {
      setErrors(result.errors);
      setShakeKey((key) => key + 1);
      return;
    }
    setErrors({});
    setFormError(null);
    setIsSubmitting(true);
    try {
      await signIn(result.data.email, result.data.password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.replace('/(tabs)/globe');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Giriş yapılamadı.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuest = async () => {
    await continueAsGuest();
    router.replace('/(tabs)/globe');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <IconButton
            icon={ChevronLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
            accessibilityLabel="Geri"
          />

          <Animated.View entering={enterUp(0)} style={styles.header}>
            <Text style={styles.overline}>TEKRAR HOŞ GELDİN</Text>
            <Text style={styles.title} accessibilityRole="header">
              Giriş Yap
            </Text>
            <Text style={styles.subtitle}>Favori istasyonların ve pasaportun seni bekliyor.</Text>
          </Animated.View>

          {!isCloudAvailable ? (
            <Animated.View entering={fadeIn()} style={styles.banner}>
              <CircleAlert size={18} color={COLORS.warning} />
              <Text style={styles.bannerText}>Bulut hesabı şu anda yapılandırılmadı. Misafir olarak devam edebilirsin.</Text>
            </Animated.View>
          ) : null}

          {formError ? (
            <Animated.View entering={fadeIn()} exiting={fadeOut()} style={[styles.banner, styles.bannerError]} accessibilityLiveRegion="assertive">
              <CircleAlert size={18} color={COLORS.error} />
              <Text style={styles.bannerText}>{formError}</Text>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(1)} style={styles.form}>
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
              placeholder="••••••••"
              secureTextEntry
              secureToggle
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
          </Animated.View>

          <Animated.View entering={enterUp(2)} style={styles.actions}>
            <Button label="Giriş Yap" onPress={handleSubmit} loading={isSubmitting} disabled={!isCloudAvailable} />
            <PressableScale onPress={() => router.replace('/(auth)/register')} style={styles.link} accessibilityRole="link">
              <Text style={styles.linkText}>
                Hesabın yok mu? <Text style={styles.linkAccent}>Üye ol</Text>
              </Text>
            </PressableScale>
            <PressableScale onPress={handleGuest} style={styles.link} accessibilityRole="button">
              <Text style={styles.linkMuted}>Misafir olarak devam et</Text>
            </PressableScale>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = authStyles;
