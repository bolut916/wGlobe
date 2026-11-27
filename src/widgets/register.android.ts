/**
 * Android: widget görev işleyicisini kaydet. Ayrı platform dosyası, çünkü Metro require() çağrılarını
 * koşuldan bağımsız paketler — iOS paketine Android widget kütüphanesi hiç girmemeli.
 */
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './widget-task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
