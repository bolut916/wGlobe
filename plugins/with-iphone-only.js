/**
 * Yalnız iPhone: uygulama `supportsTablet: false` ile iPhone'a özeldir. expo-widgets, widget uzantısı hedefini
 * iPhone + iPad ("1,2") olarak oluşturur; uzantı, onu içeren uygulamayla aynı cihaz ailesini bildirsin diye tüm
 * hedeflerde TARGETED_DEVICE_FAMILY = "1" yapılır. Tüm eklentiler projeyi yazdıktan SONRA çalışır (withFinalizedMod):
 * widget hedefi daha erken bir aşamada eklendiği için normal Xcode değişikliği onu göremezdi.
 * (iPad desteği eklenirse bu eklenti kaldırılır.)
 */
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withIphoneOnly(config) {
  return withFinalizedMod(config, ['ios', async (cfg) => {
    const iosDir = cfg.modRequest.platformProjectRoot;
    for (const dir of fs.readdirSync(iosDir).filter((d) => d.endsWith('.xcodeproj'))) {
      const file = path.join(iosDir, dir, 'project.pbxproj');
      const src = fs.readFileSync(file, 'utf8');
      const out = src.replace(/TARGETED_DEVICE_FAMILY = "?1,2"?;/g, 'TARGETED_DEVICE_FAMILY = "1";');
      if (out !== src) fs.writeFileSync(file, out);
    }
    return cfg;
  }]);
};
