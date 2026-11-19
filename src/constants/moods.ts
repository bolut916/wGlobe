import type { MoodCollection, VibeTag } from '@/types';

/**
 * Keşfet ekranının ruh hâli kürasyonları. İlk üç koleksiyon ana vitrindir;
 * diğerleri "Daha fazla atmosfer" bölümünde listelenir.
 */
export const MOOD_COLLECTIONS: readonly MoodCollection[] = [
  {
    id: 'midnight-jazz',
    title: 'Gece Yarısı Cazı',
    subtitle: 'Duman, saksafon ve ışıkları sönmeyen caddeler.',
    vibeTag: 'Gece Yarısı Cazı',
    icon: 'moon-star',
    accent: '#C89D54',
    gradient: ['#141A33', '#3A2A55'],
  },
  {
    id: 'rainy-streets',
    title: 'Yağmurlu Sokaklar',
    subtitle: 'Islak kaldırımlar, cam kenarı ve lo-fi bir akşam.',
    vibeTag: 'Yağmurlu Sokaklar',
    icon: 'cloud-rain',
    accent: '#7FA7E8',
    gradient: ['#0F1D2B', '#29445C'],
  },
  {
    id: 'morning-coffee',
    title: 'Sabah Kahvesi',
    subtitle: 'İlk yudum, ilk güneş, ilk şarkı.',
    vibeTag: 'Sabah Kahvesi',
    icon: 'coffee',
    accent: '#E2C285',
    gradient: ['#2B1D12', '#5A3B22'],
  },
  {
    id: 'tropical-rhythms',
    title: 'Tropikal Ritimler',
    subtitle: 'Nem, perküsyon ve gece pazarlarının sesi.',
    vibeTag: 'Tropikal Ritimler',
    icon: 'palmtree',
    accent: '#6FCF97',
    gradient: ['#0E2A22', '#1F5240'],
  },
  {
    id: 'desert-sunset',
    title: 'Çöl Gün Batımı',
    subtitle: 'Sıcak rüzgâr, uzun gölgeler, ud ve synth.',
    vibeTag: 'Çöl Gün Batımı',
    icon: 'sunset',
    accent: '#F2994A',
    gradient: ['#2E1A10', '#6B3A1E'],
  },
  {
    id: 'ocean-breeze',
    title: 'Okyanus Esintisi',
    subtitle: 'Tuzlu hava ve ufka uzanan bir yayın.',
    vibeTag: 'Okyanus Esintisi',
    icon: 'waves',
    accent: '#56CCF2',
    gradient: ['#0A2230', '#164A60'],
  },
] as const;

export const FEATURED_MOOD_IDS: readonly string[] = ['midnight-jazz', 'rainy-streets', 'morning-coffee'];

export function getMoodByVibe(vibe: VibeTag): MoodCollection | undefined {
  return MOOD_COLLECTIONS.find((mood) => mood.vibeTag === vibe);
}
