/**
 * Alt menü — 4 sekme. Aktif ikon 180 ms'de 1.12'ye büyür ve 2px yükselir:
 * renk değişiminin yanında küçük bir "kalkış" — nerede olduğunu hissettirir.
 */
import { Redirect, Tabs } from 'expo-router';
import { Compass, Globe, Layers, User, type LucideIcon } from 'lucide-react-native';
import { Platform, StyleSheet, type ColorValue } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { COLORS, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { useAuth } from '@/context/AuthContext';
import { easeStandard } from '@/lib/animations';

function TabIcon({ icon: Icon, color, focused }: { icon: LucideIcon; color: ColorValue; focused: boolean }) {
  const style = useAnimatedStyle(() => ({
    transform: [
      { scale: withTiming(focused ? 1.12 : 1, { duration: DURATION.toggle, easing: easeStandard }) },
      { translateY: withTiming(focused ? -2 : 0, { duration: DURATION.toggle, easing: easeStandard }) },
    ],
  }));
  return (
    <Animated.View style={style}>
      <Icon size={22} color={typeof color === 'string' ? color : COLORS.textTertiary} strokeWidth={focused ? 2.3 : 1.8} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  const { mode } = useAuth();

  if (mode === 'loading') return null;
  if (mode === 'signed_out') return <Redirect href="/(auth)/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.brass,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: COLORS.background },
        animation: 'fade',
      }}
    >
      <Tabs.Screen
        name="globe"
        options={{
          title: 'Küre',
          tabBarAccessibilityLabel: 'Küre sekmesi',
          tabBarIcon: ({ color, focused }) => <TabIcon icon={Globe} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Keşfet',
          tabBarAccessibilityLabel: 'Keşfet sekmesi',
          tabBarIcon: ({ color, focused }) => <TabIcon icon={Compass} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="themes"
        options={{
          title: 'Koleksiyon',
          tabBarAccessibilityLabel: 'Koleksiyon sekmesi',
          tabBarIcon: ({ color, focused }) => <TabIcon icon={Layers} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarAccessibilityLabel: 'Profil sekmesi',
          tabBarIcon: ({ color, focused }) => <TabIcon icon={User} color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.backgroundAlt,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Platform.OS === 'ios' ? 6 : 4,
    height: Platform.OS === 'ios' ? 86 : 64,
  },
  label: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    marginTop: 2,
  },
});
