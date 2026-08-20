import { useParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  Share2,
  ShieldCheck,
  Star,
  Tag,
  Truck,
} from 'lucide-react';
import { ProductStickyBar } from '@/components/ProductStickyBar';
import { api, isImageAssetUrl } from '@/lib/api';
import { productWhatsAppUrl } from '@/lib/storeContact';
import { buildVariantImageMap, getProductImageList } from '@/lib/productImages';
import { useCatalogLiveRefresh } from '@/lib/useCatalogLiveRefresh';
import { liveStatusLabel } from '@/lib/liveStatus';
import { formatDeliveryEta, useDeliveryCheck } from '@/lib/useDeliveryCheck';
import {
  getProductSizes,
  getVariantStockForSize,
  resolveProductVariant,
  resolveVariantId,
} from '@/lib/variants';
import { ATTRIBUTE_KEYS } from '@/features/catalog/plpFilters';
import { useApp } from '@/store/AppContext';
import { SpinViewer } from '@/ui/components';
import type { Product, ProductReview } from '@/types';

// Keys the standalone `specifications` tail must never restate: the seven typed
// attributes (shared with the PLP sidebar filters — same vocabulary, one source of
// truth) plus Occasion, which the attrs box above already renders from `p.occasions`.
// Suppressed unconditionally, even when the typed attribute is null for this product —
// a null typed attribute means "no row", not "fall back to the free-form spec value"
// (that free-form value is exactly the untrustworthy fixture text a typed attribute
// left null to avoid repeating, e.g. an `Origin` string that doesn't hold for every saree).
const SPECS_COVERED_BY_TYPED_ROWS = new Set<string>([...ATTRIBUTE_KEYS, 'occasion']);

export function ProductDetail() {
  const { id } = useParams<{ gender: string; id: string }>();
  const navigate = useNavigate();
  const { addToCart, toggleWishlist, isInWishlist, showToast } = useApp();
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedThumb, setSelectedThumb] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifyPhone, setNotifyPhone] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');
  const {
    pinCode,
    setPinCode,
    delivery,
    status: deliveryStatus,
    error: deliveryError,
    checkDelivery,
    isChecking,
  } = useDeliveryCheck(product?.slug || id, { enabled: Boolean(product?.slug || id) });

  const loadProduct = useCallback(() => {
    if (!id) return Promise.resolve();
    setLoading(true);
    return api.products.get(id)
      .then((item) => {
        setProduct(item);
        setSelectedThumb(0);
        setSelectedColor(0);
        const sizes = getProductSizes(item);
        const defaultSize = sizes.find(size => getVariantStockForSize(item, size) > 0) || sizes[0] || '';
        setSelectedSize(defaultSize);
        setQuantity(1);
        return api.products.reviews.list(item.slug).then(setReviews);
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    window.scrollTo(0, 0);
    queueMicrotask(() => {
      void loadProduct();
    });
  }, [id, loadProduct]);

  const realtimeStatus = useCatalogLiveRefresh({
    enabled: Boolean(product || id),
    productId: product?.id,
    slug: product?.slug || id,
    onUpdate: () => {
      void loadProduct();
      void checkDelivery();
    },
  });

  const variantImageMap = useMemo(
    () => buildVariantImageMap(product?.image_records),
    [product?.image_records],
  );

  const sizeOptions = useMemo(() => (product ? getProductSizes(product) : []), [product]);

  const activeVariant = useMemo(() => {
    if (!product) return undefined;
    return resolveProductVariant(product, {
      size: selectedSize || undefined,
      colorIndex: selectedColor,
    });
  }, [product, selectedColor, selectedSize]);

  const imageList = useMemo(
    () => (product ? getProductImageList(product, activeVariant?.id, variantImageMap) : []),
    [activeVariant?.id, product, variantImageMap],
  );

  if (loading) {
    return (
      <div className="pd-page pd-loading-page" aria-live="polite">
        <div className="pd-loading-shell">
          <div className="pd-loading-media shimmer" />
          <div className="pd-loading-copy">
            <div className="shimmer pd-loading-line wide" />
            <div className="shimmer pd-loading-line" />
            <div className="shimmer pd-loading-line short" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="pd-page pd-empty-page">
        <div className="catalog-empty">
          <div className="catalog-empty-mark">CSM</div>
          <h2>Product not found</h2>
          <p>This weave may have moved or sold out from live inventory.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Back to home</button>
        </div>
      </div>
    );
  }

  const p = product;
  const activePrice = Number(activeVariant?.price || p.price || 0);
  const activeMrp = Number(activeVariant?.mrp || p.mrp || activePrice);
  const activeStock = Number(activeVariant?.available_qty ?? p.available_qty ?? 0);
  const disc = activeMrp ? Math.max(0, Math.round((1 - activePrice / activeMrp) * 100)) : 0;
  const inWish = isInWishlist(p.id);
  const canPurchase = activeStock > 0;
  const maxQty = Math.max(1, Math.min(activeStock || 1, 10));

  const attrs = (() => {
    if (p.gender !== 'men') {
      // Sarees: the server sends typed rows, already including Border, Pallu, Weight
      // and Saree Length. No invented fallbacks — a saree with no recorded zari shows
      // no Zari row rather than a guessed "Gold Zari".
      const rows: Array<[string, string]> = (p.attributes || []).map(
        row => [row.label, row.value] as [string, string],
      );
      if ((p.occasions || []).length) rows.push(['Occasion', (p.occasions || []).join(' / ')]);
      if (p.gender === 'women') rows.push(['House finishing', 'Blouse stitching + fall/pico at checkout']);
      return rows;
    }

    const length = activeVariant?.length_meters || p.length_meters;
    const spec = p.specifications || {};
    const rows: Array<[string, string]> = [
      ['Material', activeVariant?.fabric || 'Pure Silk'],
      ['Zari', activeVariant?.zari_type || 'Gold Zari'],
      ['Size', activeVariant?.size || selectedSize || 'S to 5XL'],
      ['Care', activeVariant?.care_instructions || 'Dry Clean Only'],
    ];
    if (length) rows.push(['Length', `${length} m`]);
    for (const key of ['Weight', 'Border', 'Pallu'] as const) {
      if (spec[key]) rows.push([key, spec[key]]);
    }
    return rows;
  })();

  const buildCartProduct = () => ({
    ...p,
    variant_id: resolveVariantId(p, { size: selectedSize || undefined, colorIndex: selectedColor }),
    price: activePrice,
    mrp: activeMrp,
  });

  const handleAddToCart = () => {
    if (!canPurchase) return;
    void addToCart(buildCartProduct(), quantity);
  };

  const handleBuyNow = async () => {
    if (!canPurchase) return;
    const added = await addToCart(buildCartProduct(), quantity);
    if (added) navigate('/cart');
  };

  const handleStockAlert = async (event: FormEvent) => {
    event.preventDefault();
    if (!p.slug) return;
    setNotifyBusy(true);
    setNotifyMsg('');
    try {
      const result = await api.products.stockAlert(p.slug, {
        phone: notifyPhone.trim(),
        email: notifyEmail.trim() || undefined,
        variant_id: activeVariant?.id,
      });
      setNotifyMsg(result.message || 'We will message you when this weave is back.');
    } catch (err) {
      setNotifyMsg(err instanceof Error ? err.message : 'Could not save your alert.');
    } finally {
      setNotifyBusy(false);
    }
  };

  const submitDeliveryCheck = (event?: FormEvent) => {
    event?.preventDefault();
    void checkDelivery();
  };

  const etaText = formatDeliveryEta(delivery);
  const deliveryMessage = deliveryError
    || (delivery?.serviceable
      ? `Delivery by ${etaText}. ${delivery.cod_available ? 'Cash on delivery available.' : 'Prepaid orders only.'}`
      : delivery?.message || (isChecking ? 'Checking delivery for your PIN...' : 'Enter PIN to check delivery'));

  const shareProduct = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: p.name, text: p.hook || p.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('OK', 'Link copied', 'Product link copied to clipboard');
    } catch {
      showToast('!', 'Share unavailable', 'Could not share this product right now');
    }
  };

  return (
    <div className="pd-page pd-flipkart">
      <div className="pd-grid">
        <div className="pd-gallery">
          <div className="pd-main-img">
            <SpinViewer
              product={p}
              images={imageList}
              index={Math.min(selectedThumb, Math.max(imageList.length - 1, 0))}
              onIndexChange={setSelectedThumb}
            />
            {disc > 0 && <span className="pd-gallery-off">{disc}% OFF</span>}
          </div>
          <div className="pd-thumbs">
            {imageList.map((value, i) => (
              <button
                type="button"
                key={`${value}-${i}`}
                className={`pd-thumb ${i === selectedThumb ? 'on' : ''}`}
                style={isImageAssetUrl(value) ? { backgroundImage: `url(${value})` } : { background: value }}
                onClick={() => setSelectedThumb(i)}
                aria-label={`View product image ${i + 1}`}
              >
                {!isImageAssetUrl(value) && 'CSM'}
              </button>
            ))}
          </div>
        </div>

        <div className="pd-info">
          <div className="pd-breadcrumb" onClick={() => navigate(p.gender === 'men' ? '/mens' : '/womens')}>
            Home <span>/</span> {p.gender === 'men' ? "Men's Silk" : "Women's Sarees"} <span>/</span> {p.cat}
          </div>

          <div className="pd-title-row">
            <h1 className="pd-title">{p.name}</h1>
            <div className="pd-title-actions">
              <button type="button" className="pd-icon-btn" onClick={() => void toggleWishlist(p)} aria-label={inWish ? 'Remove from wishlist' : 'Save to wishlist'}>
                <Heart size={18} fill={inWish ? 'currentColor' : 'none'} />
              </button>
              <button type="button" className="pd-icon-btn" onClick={() => void shareProduct()} aria-label="Share product">
                <Share2 size={18} />
              </button>
            </div>
          </div>

          <div className="pd-badges">
            {p.assured && <span className="pd-badge pdb-assured"><BadgeCheck size={14} /> CSM Assured</span>}
            <span className="pd-badge pdb-gold">{p.cat}</span>
            <span className={`pd-badge ${canPurchase ? 'pdb-grn' : 'pdb-danger'}`}>
              {canPurchase ? `${activeStock} in stock` : 'Sold out'}
            </span>
            <span className={`ws-chip ${realtimeStatus}`}>{liveStatusLabel(realtimeStatus, 'stock')}</span>
            {p.is_gi_tagged && <span className="pd-badge pdb-blu">GI Tagged</span>}
          </div>

          <div className="pd-rating">
            <span className="pd-stars"><Star size={14} fill="currentColor" /> {Number(p.avg_rating || 0).toFixed(1)}</span>
            <span>{p.review_count || 0} ratings</span>
            {activeVariant?.sku && <span className="pd-sku">SKU: {activeVariant.sku}</span>}
          </div>

          <div className="pd-price-panel">
            <div className="pd-price-row">
              <div className="pd-price">Rs {activePrice.toLocaleString('en-IN')}</div>
              {activeMrp > activePrice && <div className="pd-mrp">Rs {activeMrp.toLocaleString('en-IN')}</div>}
              {disc > 0 && <div className="pd-off">{disc}% off</div>}
            </div>
            <div className="pd-tax-note">Inclusive of all taxes</div>
          </div>

          <div className="pd-offers">
            {[p.deal_label || 'Special price', 'Extra 5% off on prepaid orders', 'Free shipping above Rs 999'].map(offer => (
              <div key={offer} className="pd-offer"><Tag size={15} /> {offer}</div>
            ))}
          </div>

          <div className="pd-delivery-card">
            <div className="pd-delivery-title">
              <MapPin size={17} />
              Delivery &amp; services
              <span className={`pd-delivery-live ${deliveryStatus}`}>
                {isChecking ? 'Checking' : deliveryStatus === 'ready' ? 'Live' : 'PIN check'}
              </span>
            </div>
            <form className="pd-pin-row" onSubmit={submitDeliveryCheck}>
              <input
                value={pinCode}
                onChange={event => setPinCode(event.target.value)}
                placeholder="Enter 6-digit PIN"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                aria-label="Delivery PIN code"
              />
              <button type="submit" disabled={isChecking}>
                {isChecking ? <Loader2 size={16} className="spin" /> : 'Check'}
              </button>
            </form>
            <div className={`pd-delivery-result ${delivery?.serviceable ? 'ok' : ''} ${isChecking ? 'checking' : ''}`}>
              {isChecking ? <Loader2 size={16} className="spin" /> : <Truck size={16} />}
              <span>{deliveryMessage}</span>
            </div>
            {delivery?.serviceable && (
              <div className="pd-delivery-perks">
                {delivery.exchange_available && <span>Easy exchange</span>}
                {delivery.return_days ? <span>{delivery.return_days}-day returns</span> : null}
                {p.assured && <span>Quality checked dispatch</span>}
              </div>
            )}
          </div>

          {sizeOptions.length > 0 && (
            <>
              <div className="pd-section-lbl">Select size</div>
              <div className="pd-size-row">
                {sizeOptions.map(size => {
                  const stock = getVariantStockForSize(p, size, selectedColor);
                  return (
                    <button
                      key={size}
                      type="button"
                      className={`pd-size-chip ${selectedSize === size ? 'on' : ''} ${stock <= 0 ? 'disabled' : ''}`}
                      onClick={() => {
                        if (stock <= 0) return;
                        setSelectedSize(size);
                        setSelectedThumb(0);
                      }}
                      disabled={stock <= 0}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="pd-section-lbl">Select colour</div>
          <div className="pd-colors">
            {(p.variants?.length ? p.variants : p.colors.map((c, i) => ({ id: i, color_hex: c }))).map((v, i) => (
              <button
                type="button"
                key={v.id}
                className={`pd-color ${i === selectedColor ? 'on' : ''}`}
                style={{ background: v.color_hex || p.colors[i] }}
                onClick={() => {
                  setSelectedColor(i);
                  setSelectedThumb(0);
                }}
                aria-label={`Select colour ${i + 1}`}
                aria-pressed={i === selectedColor}
              />
            ))}
          </div>

          <div className="pd-section-lbl">Quantity</div>
          <div className="pd-qty-row">
            <button type="button" className="pd-qty-btn" onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity">
              <Minus size={16} />
            </button>
            <span className="pd-qty-value" aria-live="polite">{quantity}</span>
            <button type="button" className="pd-qty-btn" onClick={() => setQuantity(q => Math.min(maxQty, q + 1))} disabled={quantity >= maxQty} aria-label="Increase quantity">
              <Plus size={16} />
            </button>
            <span className="pd-qty-note">{canPurchase ? `${activeStock} units available` : 'Currently unavailable'}</span>
          </div>

          <div className="pd-cta-row pd-desktop-cta">
            <button type="button" className="pd-btn-cart" onClick={handleAddToCart} disabled={!canPurchase} aria-label={canPurchase ? 'Add to cart' : 'Sold out'}>
              {canPurchase ? 'Add to cart' : 'Sold out'}
            </button>
            <button type="button" className="pd-btn-buy" onClick={() => void handleBuyNow()} disabled={!canPurchase} aria-label={canPurchase ? 'Buy now' : 'Unavailable'}>
              {canPurchase ? 'Buy now' : 'Unavailable'}
            </button>
          </div>
          <a
            className="pd-wa-link"
            href={productWhatsAppUrl({ name: p.name, sku: activeVariant?.sku, price: activePrice })}
            target="_blank"
            rel="noreferrer noopener"
          >
            <MessageCircle size={16} /> Ask about this weave on WhatsApp
          </a>
          {!canPurchase && (
            <form className="pd-notify" onSubmit={(event) => void handleStockAlert(event)}>
              <p>This weave is spoken for. Leave your WhatsApp — we will ping you when it returns to the loom.</p>
              <div className="pd-notify-row">
                <input
                  value={notifyPhone}
                  onChange={(event) => setNotifyPhone(event.target.value)}
                  placeholder="WhatsApp number"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  aria-label="WhatsApp number for stock alert"
                />
                <input
                  value={notifyEmail}
                  onChange={(event) => setNotifyEmail(event.target.value)}
                  placeholder="Email (optional)"
                  type="email"
                  autoComplete="email"
                  aria-label="Email for stock alert"
                />
                <button type="submit" disabled={notifyBusy}>{notifyBusy ? 'Saving...' : 'Notify me'}</button>
              </div>
              {notifyMsg && <small>{notifyMsg}</small>}
            </form>
          )}

          <div className="pd-section-lbl">Product details</div>
          <div className="pd-attrs">
            {attrs.map(([label, value]) => (
              <div key={label} className="pd-attr">
                <div className="pda-l">{label}</div>
                <div className="pda-v">{value}</div>
              </div>
            ))}
          </div>

          {!!p.key_highlights?.length && (
            <>
              <div className="pd-section-lbl">Highlights</div>
              <div className="pd-highlights">
                {p.key_highlights.map(item => (
                  <div key={item}><CheckCircle2 size={15} /> {item}</div>
                ))}
              </div>
            </>
          )}

          <div className="pd-guarantee">
            <div className="pd-g">Free {p.gender === 'men' ? 'matching piece' : 'blouse'} included where applicable</div>
            <div className="pd-g">15-day easy returns</div>
            <div className="pd-g">Free pan-India shipping above Rs 999</div>
            <div className="pd-g">GST invoice provided</div>
          </div>

          <div className="pd-seller">
            <ShieldCheck size={18} />
            <div>
              <strong>{delivery?.seller_name || p.seller_name || 'CSM Silks Kanchipuram'}</strong>
              <span>{p.return_days || 15}-day returns, exchange support, GST invoice, and quality check before dispatch.</span>
            </div>
          </div>

          {(() => {
            const extraSpecs = Object.entries(p.specifications || {}).filter(
              ([key]) => !SPECS_COVERED_BY_TYPED_ROWS.has(key.toLowerCase()),
            );
            if (!extraSpecs.length) return null;
            return (
              <div className="pd-spec-table">
                {extraSpecs.map(([key, value]) => (
                  <div key={key}><span>{key}</span><strong>{value}</strong></div>
                ))}
              </div>
            );
          })()}

          <div className="pd-review-panel" id="reviews">
            <div className="pd-review-head">
              <strong>Ratings &amp; reviews</strong>
              <span>{Number(p.avg_rating || 0).toFixed(1)} average</span>
            </div>
            {(reviews.length ? reviews : []).slice(0, 4).map(review => (
              <div className="pd-review" key={review.id}>
                <div><Star size={13} fill="currentColor" /> {review.rating}</div>
                <strong>{review.title}</strong>
                <p>{review.body}</p>
                <span>{review.customer || 'Verified customer'} {review.is_verified_purchase ? '· verified purchase' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ProductStickyBar
        price={activePrice}
        inStock={canPurchase}
        onAddToCart={handleAddToCart}
        onBuyNow={() => void handleBuyNow()}
      />
    </div>
  );
}
