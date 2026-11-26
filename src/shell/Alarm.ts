/**
 * Radyolu alarm: "güneşin doğduğu yerden uyan".
 *
 * iOS ve Android, bir uygulamanın belirli bir saatte kendiliğinden canlı yayın başlatmasına izin vermez. Bu yüzden
 * alarm her gün seçilen saatte sesli bir bildirimdir; bildirime dokununca uygulama açılır ve web arayüzü o anda
 * güneşin doğduğu şehrin radyosunu başlatır ('alarm:fire').
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { AlarmSetMessage, NativeMessage } from './bridge';

const CHANNEL = 'wglobe-alarm';
const KIND = 'wglobe-sunrise-alarm';
let configured = false;

/** Uygulama açıkken gelen alarm da görünsün; Android'de yüksek öncelikli, sesli kanal. */
export async function configureAlarm(): Promise<void> {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Alarm', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 250, 250, 250] });
    } catch { /* kanal kurulamazsa varsayılan kanal kullanılır */ }
  }
}

/** Alarmı kurar ya da kapatır; sonucu ('alarm:status') web'e bildirir. Hiçbir durumda fırlatmaz. */
export async function setAlarm(m: AlarmSetMessage, emit: (msg: NativeMessage) => void): Promise<void> {
  try {
    await configureAlarm();
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled
      .filter((n) => (n.content.data as Record<string, unknown> | null)?.kind === KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!m.enabled) { emit({ type: 'alarm:status', ok: true, enabled: false }); return; }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) { emit({ type: 'alarm:status', ok: false, enabled: false, reason: 'permission' }); return; }
    await Notifications.scheduleNotificationAsync({
      content: { title: m.title, body: m.body, sound: 'default', data: { kind: KIND } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: m.hour, minute: m.minute, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
    });
    emit({ type: 'alarm:status', ok: true, enabled: true, hour: m.hour, minute: m.minute });
  } catch {
    emit({ type: 'alarm:status', ok: false, enabled: false, reason: 'error' });
  }
}

/** Bu dokunuş alarm bildirimine mi? */
export function isAlarmResponse(r: Notifications.NotificationResponse | null | undefined): boolean {
  return !!r && (r.notification.request.content.data as Record<string, unknown> | null)?.kind === KIND;
}
