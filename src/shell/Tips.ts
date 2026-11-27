/**
 * Geliştiriciye destek — uygulama içi bahşiş (expo-iap: iOS StoreKit 2, Android Google Play Billing).
 *
 * Kurallar (App Store Review Guidelines 3.1.1, Google Play Ödemeler politikası):
 *  - Bahşiş yalnız mağazanın kendi satın alma sistemiyle alınır; uygulamada dış ödeme bağlantısı yoktur.
 *  - Üç ürün de TÜKETİLEBİLİR'dir: tekrar tekrar verilebilir, hiçbir özelliği açmaz, geri yükleme gerekmez.
 *  - Her işlem bitirilir/tüketilir (finishTransaction isConsumable). Android'de tüketilmeyen satın alma 3 gün
 *    sonra iade edilir ve aynı ürün yeniden alınamaz.
 *  - Fiyatlar mağazadan gelir (yerel para birimi, vergi dahil biçim); uygulamada fiyat yazılmaz.
 * Uygulama satın alma sırasında kapanırsa ya da ödeme onay bekliyorsa (Ask to Buy, Android bekleyen ödeme),
 * işlem bir sonraki bağlantıda tamamlanır ve teşekkür "late" olarak gönderilir. Aynı işlem iki kez sayılmaz.
 */
import {
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';

import { TIP_SKUS, type NativeMessage, type TipProduct, type TipSku } from './bridge';

/** expo-iap dinleyicisi ve istisnalar farklı hata biçimleri verir: yalnız ortak alanlar okunur */
type StoreError = { code?: string | null; productId?: string | null } | null | undefined;

const isTip = (id: string | null | undefined): id is TipSku => !!id && (TIP_SKUS as readonly string[]).includes(id);

export class Tips {
  private connected: Promise<boolean> | null = null;
  private subs: { remove(): void }[] = [];
  /** Bitirilmiş işlemler: aynı işlem için ikinci teşekkür gitmez */
  private finished = new Set<string>();
  /** Şu an kullanıcının başlattığı satın alma (sonucu yalnız bir kez bildirilir) */
  private buying: TipSku | null = null;

  constructor(private emit: (m: NativeMessage) => void) {}

  private connect(): Promise<boolean> {
    if (!this.connected) {
      this.connected = (async () => {
        try {
          const ok = await initConnection();
          if (!ok) return false;
          this.subs.push(purchaseUpdatedListener((p) => { void this.onPurchase(p, false); }));
          this.subs.push(purchaseErrorListener((e) => this.onError(e)));
          void this.recover();
          return true;
        } catch {
          return false;
        }
      })();
      // Bağlantı kurulamadıysa sonraki istekte yeniden denensin
      void this.connected.then((ok) => { if (!ok) this.connected = null; });
    }
    return this.connected;
  }

  /** Yarım kalmış (uygulama kapanmış / onay beklemiş) bahşişleri tamamla. */
  private async recover(): Promise<void> {
    try {
      const list = await getAvailablePurchases();
      for (const p of list) if (isTip(p.productId)) await this.onPurchase(p, true);
    } catch { /* mağaza sorgusu başarısız: bir sonraki açılışta yeniden denenir */ }
  }

  async load(): Promise<void> {
    if (!(await this.connect())) { this.emit({ type: 'tip:products', items: [], error: 'unavailable' }); return; }
    try {
      const products = await fetchProducts({ skus: [...TIP_SKUS], type: 'in-app' });
      const byId = new Map((Array.isArray(products) ? products : []).map((p) => [p.id, p]));
      const items: TipProduct[] = [];
      for (const id of TIP_SKUS) {
        const p = byId.get(id);
        if (p && typeof p.displayPrice === 'string' && p.displayPrice) items.push({ id, price: p.displayPrice.slice(0, 24) });
      }
      this.emit(items.length ? { type: 'tip:products', items } : { type: 'tip:products', items: [], error: 'unavailable' });
    } catch {
      this.emit({ type: 'tip:products', items: [], error: 'unavailable' });
    }
  }

  async buy(id: TipSku): Promise<void> {
    if (this.buying) return;   // mağaza penceresi zaten açık
    if (!(await this.connect())) { this.emit({ type: 'tip:result', id, status: 'error' }); return; }
    this.buying = id;
    try {
      await requestPurchase({ type: 'in-app', request: { apple: { sku: id }, google: { skus: [id] } } });
      // Sonuç dinleyicilerden gelir (onPurchase / onError)
    } catch (e) {
      this.onError(e as StoreError);
    }
  }

  private async onPurchase(p: Purchase, late: boolean): Promise<void> {
    if (!isTip(p.productId)) return;
    const key = p.id || p.purchaseToken || `${p.productId}:${p.transactionDate}`;
    if (p.purchaseState === 'pending') {
      if (this.buying === p.productId) { this.buying = null; this.emit({ type: 'tip:result', id: p.productId, status: 'pending' }); }
      return;   // onaylanınca yeniden gelir
    }
    if (p.purchaseState !== 'purchased' || this.finished.has(key)) return;
    try {
      await finishTransaction({ purchase: p, isConsumable: true });
    } catch {
      return;   // bitirilemedi: mağaza bir sonraki açılışta yeniden bildirir
    }
    this.finished.add(key);
    const mine = this.buying === p.productId;
    if (mine) this.buying = null;
    this.emit({ type: 'tip:result', id: p.productId, status: 'success', ...(late || !mine ? { late: true } : {}) });
  }

  private onError(e: StoreError): void {
    const id = this.buying; if (!id) return;
    if (e && e.productId && e.productId !== id) return;
    this.buying = null;
    const code = e && e.code;
    const status = code === ErrorCode.UserCancelled ? 'cancelled' : code === ErrorCode.Pending ? 'pending' : 'error';
    this.emit({ type: 'tip:result', id, status });
  }

  destroy(): void {
    this.subs.forEach((s) => { try { s.remove(); } catch { /* yok */ } });
    this.subs = [];
  }
}
