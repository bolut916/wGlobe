import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Snowflake,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';

import { COLORS } from '@/constants/colors';
import type { WeatherIconName } from '@/types';

const ICONS: Record<WeatherIconName, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  'cloud-sun': CloudSun,
  'cloud-moon': CloudMoon,
  cloud: Cloud,
  'cloud-fog': CloudFog,
  'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain,
  'cloud-snow': CloudSnow,
  snowflake: Snowflake,
  'cloud-lightning': CloudLightning,
  'cloud-hail': CloudHail,
};

export function WeatherIcon({ name, size = 20, color = COLORS.brassLight }: { name: WeatherIconName; size?: number; color?: string }) {
  const Icon = ICONS[name] ?? Cloud;
  return <Icon size={size} color={color} strokeWidth={1.8} />;
}

export default WeatherIcon;
