/**
 * Android widget görev işleyicisi: widget eklendiğinde, yeniden boyutlandığında ya da sistem güncelleme
 * istediğinde (uygulama kapalı olabilir) diskteki son durumdan çizer. Tıklamalar OPEN_URI ile doğrudan
 * uygulamayı açar; burada ayrıca işlenmez.
 */
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { NowPlayingAndroid } from './NowPlayingAndroid';
import { WIDGET_NAME } from './model';
import { artData } from './publish.android';
import { loadProps } from './store';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const p = await loadProps();
      const art = await artData(p.art);
      props.renderWidget(<NowPlayingAndroid {...p} artData={art} width={props.widgetInfo.width} height={props.widgetInfo.height} />);
      break;
    }
    default:
      break;
  }
}
