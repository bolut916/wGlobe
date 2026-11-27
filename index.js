// Uygulama girişi: Expo Router + (yalnız Android) ana ekran widget'ının görev işleyicisi.
// Widget, uygulama kapalıyken de bu paketin başsız JS görevinde çizilir. Platform ayrımı dosya adıyla
// yapılır (register.android.ts / register.ts): iOS paketine Android widget kodu girmez.
import 'expo-router/entry';
import './src/widgets/register';
