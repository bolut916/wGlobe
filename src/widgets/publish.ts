/**
 * Platformdan bağımsız yedek (web ve tür denetimi): widget yoktur, hiçbir şey yapılmaz.
 * Gerçek uygulamalar: publish.ios.ts (expo-widgets) ve publish.android.tsx (react-native-android-widget).
 */
import type { WidgetProps } from './model';

export const artDirectory = (): string | null => null;
export async function publishWidget(_p: WidgetProps): Promise<void> { /* widget yok */ }
