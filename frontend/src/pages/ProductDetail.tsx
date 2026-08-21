import { useParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  FileText,
  Flame,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Share2,
  ShieldCheck,
  Star,
  Tag,
  Truck,
} from 'lucide-react';
import { ProductStickyBar } from '@/components/ProductStickyBar';
import { ProductCard } from '@/features/catalog/components/ProductCard';
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
import { useApp } from '@/store/AppContext';
import { SpinViewer } from '@/ui/components';
import type { Product, ProductReview } from '@/types';

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
  // Keyed by the product it was fetched for, so switching products never needs a
  // synchronous reset in the effect body — stale results are ignored at render.
  const [related, setRelated] = useState<{ forId: number; items: Product[] }>({ forId: 0, items: [] });
  const [descExpanded, setDescExpanded] = useState(false);
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

  // Cross-sell rail: same category, minus this product. Failure is silent — the rail
  // simply does not render rather than blocking the PDP.
  const relatedCategory = product?.category_slug;
  const relatedGender = product?.gender;
  const productId = product?.id;
  useEffect(() => {
    if (!productId || (!relatedCategory && !relatedGender)) return;
    let cancelled = false;
    // Categories here are narrow — often one or two products — so a category-only
    // rail reads as unfinished. Lead with same-category matches, then top up from
    // the same gender until the rail is worth showing.
    const MIN_RAIL = 4;
    const load = async () => {
      const found: Product[] = [];
      const seen = new Set<number>([productId]);
      const absorb = (items: Product[]) => {
        for (const item of items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          found.push(item);
        }
      };

      if (relatedCategory) {
        const byCategory = await api.products.list({ category: relatedCategory, page_size: 12 });
        absorb(byCategory.items || []);
      }
      if (found.length < MIN_RAIL && relatedGender) {
        const byGender = await api.products.list({ gender: relatedGender, page_size: 16 });
        absorb(byGender.items || []);
      }
      return found.slice(0, 8);
    };

    load()
      .then(items => {
        if (!cancelled) setRelated({ forId: productId, items });
      })
      .catch(() => {
        if (!cancelled) setRelated({ forId: productId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [relatedCategory, relatedGender, productId]);

  // Distribution is computed from the reviews actually loaded, so the bars always
  // reconcile with the list below them. review_count may exceed reviews.length when
  // the API paginates, so the bars are labelled by what we have, not by that total.
  const ratingBars = useMemo(() => {
    const counts = [5, 4, 3, 2, 1].map(star => ({
      star,
      count: reviews.filter(review => Math.round(Number(review.rating) || 0) === star).length,
    }));
    const total = reviews.length;
    return counts.map(entry => ({
      ...entry,
      pct: total ? Math.round((entry.count / total) * 100) : 0,
    }));
  }, [reviews]);

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
  // Ignore results still in flight from a previously viewed product.
  const relatedItems = related.forId === p.id ? related.items : [];
  const selectedColorName = (p.variants?.[selectedColor]?.color_name || '').trim();
  const etaMin = Number(p.delivery_min_days) || 0;
  const etaMax = Number(p.delivery_max_days) || 0;
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
          <nav className="pd-breadcrumb" aria-label="Breadcrumb">
            <button type="button" className="pd-crumb" onClick={() => navigate('/')}>Home</button>
            <span aria-hidden="true">/</span>
            <button type="button" className="pd-crumb" onClick={() => navigate(p.gender === 'men' ? '/mens' : '/womens')}>
              {p.gender === 'men' ? "Men's Silk" : "Women's Sarees"}
            </button>
            <span aria-hidden="true">/</span>
            <span className="pd-crumb-current" aria-current="page">{p.cat}</span>
          </nav>

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
            {Number(p.total_sold) > 0 && (
              <span className="pd-sold"><Flame size={13} /> {Number(p.total_sold).toLocaleString('en-IN')} sold</span>
            )}
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
            {/* Give a delivery window before any PIN is typed — the recorded
                per-product range, not a guess. Suppressed if unset. */}
            {etaMin > 0 && etaMax > 0 && (
              <div className="pd-eta-note">
                Estimated delivery {etaMin}–{etaMax} working days
              </div>
            )}
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
              {/* "Label : value" reads the current selection back to the shopper,
                  rather than a bare instruction that never changes. */}
              <div className="pd-section-lbl">
                Size{selectedSize ? <span className="pd-lbl-val"> : {selectedSize}</span> : null}
              </div>
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

          {/* Colour name only when the variant actually records one — unnamed
              swatches stay unlabelled rather than inventing "Colour 1". */}
          <div className="pd-section-lbl">
            Colour{selectedColorName ? <span className="pd-lbl-val"> : {selectedColorName}</span> : null}
          </div>
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

          {p.description?.trim() && (() => {
            const body = p.description.trim();
            // Only clamp when there is genuinely more to reveal — otherwise a short
            // description gets a fade gradient laid over its final line for no reason.
            const clampable = body.length > 260;
            return (
              <>
                <div className="pd-section-lbl">About this weave</div>
                <div className={`pd-desc ${clampable ? 'clamped' : ''} ${descExpanded ? 'open' : ''}`}>
                  <p>{body}</p>
                </div>
                {clampable && (
                  <button
                    type="button"
                    className="pd-desc-toggle"
                    onClick={() => setDescExpanded(open => !open)}
                    aria-expanded={descExpanded}
                  >
                    {descExpanded ? 'Show less' : 'Read more'}
                    <ChevronDown size={15} className={descExpanded ? 'flip' : ''} />
                  </button>
                )}
              </>
            );
          })()}

          {(!!p.occasions?.length || !!p.tags?.length) && (
            <>
              <div className="pd-section-lbl">Styled for</div>
              <div className="pd-chips">
                {(p.occasions || []).map(item => (
                  <span key={`occ-${item}`} className="pd-chip pd-chip-occasion">{item}</span>
                ))}
                {(p.tags || []).map(item => (
                  <span key={`tag-${item}`} className="pd-chip">#{item}</span>
                ))}
              </div>
            </>
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

          {/* Size & fit is rendered strictly from recorded variant rows. There is no
              measurement data on ProductVariant, so no cm/inch chart is shown rather
              than a guessed one — same rule the attribute table follows. */}
          {(p.variants || []).some(variant => variant.size) && (
            <>
              <div className="pd-section-lbl"><Ruler size={15} /> Size &amp; fit</div>
              <div className="pd-fit-table">
                <div className="pd-fit-head">
                  <span>Size</span><span>Fabric</span><span>Length</span><span>Availability</span>
                </div>
                {(p.variants || []).filter(variant => variant.size).map(variant => (
                  <div
                    key={variant.id}
                    className={`pd-fit-row ${variant.size === selectedSize ? 'on' : ''}`}
                  >
                    <span>{variant.size}</span>
                    <span>{variant.fabric || '—'}</span>
                    <span>{variant.length_meters ? `${variant.length_meters} m` : '—'}</span>
                    <span className={Number(variant.available_qty) > 0 ? 'ok' : 'out'}>
                      {Number(variant.available_qty) > 0 ? `${variant.available_qty} left` : 'Sold out'}
                    </span>
                  </div>
                ))}
              </div>
              <a
                className="pd-fit-help"
                href={productWhatsAppUrl({ name: p.name, sku: activeVariant?.sku, price: activePrice })}
                target="_blank"
                rel="noreferrer noopener"
              >
                <MessageCircle size={14} /> Unsure of your size? Ask our Kanchipuram team
              </a>
            </>
          )}

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

          {/* Trust triplet: icon + promise + qualifier, instead of a flat chip list.
              Return window comes from the product record, not a hardcoded 15. */}
          <div className="pd-trust">
            <div className="pd-trust-item">
              <Truck size={20} />
              <strong>Free shipping</strong>
              <span>On orders above Rs 999</span>
            </div>
            <div className="pd-trust-item">
              <RotateCcw size={20} />
              <strong>Easy returns</strong>
              <span>Within {p.return_days || 15} days</span>
            </div>
            <div className="pd-trust-item">
              <FileText size={20} />
              <strong>GST invoice</strong>
              <span>Included with every order</span>
            </div>
          </div>
          <div className="pd-guarantee">
            <div className="pd-g">Free {p.gender === 'men' ? 'matching piece' : 'blouse'} included where applicable</div>
            {p.exchange_available && <div className="pd-g">Exchange support</div>}
            <div className="pd-g">Quality checked before dispatch</div>
          </div>

          <div className="pd-seller">
            <ShieldCheck size={18} />
            <div>
              <strong>{delivery?.seller_name || p.seller_name || 'CSM Silks Kanchipuram'}</strong>
              <span>{p.return_days || 15}-day returns, exchange support, GST invoice, and quality check before dispatch.</span>
            </div>
          </div>

          {(() => {
            // `p.attribute_labels` is server-driven and lists every typed-attribute
            // label — including ones this product leaves null (e.g. a null Origin) —
            // so a key with a typed home never gets "rescued" back into view here just
            // because the typed row itself was omitted.
            const coveredLabels = new Set((p.attribute_labels || []).map(label => label.toLowerCase()));
            const extraSpecs = Object.entries(p.specifications || {}).filter(
              ([key]) => !coveredLabels.has(key.toLowerCase()),
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
            {reviews.length > 0 && (
              <div className="pd-rating-dist">
                <div className="pd-rating-score">
                  <strong>{Number(p.avg_rating || 0).toFixed(1)}</strong>
                  <span className="pd-rating-stars" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star
                        key={star}
                        size={13}
                        fill={star <= Math.round(Number(p.avg_rating) || 0) ? 'currentColor' : 'none'}
                      />
                    ))}
                  </span>
                  <small>{reviews.length} shown</small>
                </div>
                <div className="pd-rating-bars">
                  {ratingBars.map(bar => (
                    <div className="pd-rating-bar" key={bar.star}>
                      <span className="pdr-star">{bar.star}<Star size={10} fill="currentColor" /></span>
                      <span className="pdr-track">
                        <span className="pdr-fill" style={{ width: `${bar.pct}%` }} />
                      </span>
                      <span className="pdr-count">{bar.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

      {relatedItems.length > 0 && (
        <section className="pd-related" aria-labelledby="pd-related-title">
          <div className="pd-related-head">
            {/* Only claim the category when every card actually belongs to it —
                the rail tops up from the same gender when the category is thin. */}
            <h2 id="pd-related-title">
              {relatedItems.every(item => item.cat === p.cat) ? `More from ${p.cat}` : 'You may also like'}
            </h2>
            <button type="button" onClick={() => navigate(p.gender === 'men' ? '/mens' : '/womens')}>
              View all
            </button>
          </div>
          <div className="pd-related-rail">
            {relatedItems.map(item => (
              <div className="pd-related-item" key={item.id}>
                <ProductCard product={item} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Product structured data for search engines. Every value is taken from the
          live record — no rating node is emitted when the product has no ratings,
          since Google treats an invented aggregateRating as a policy violation. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: p.name,
            description: p.description || p.hook || undefined,
            sku: activeVariant?.sku || undefined,
            brand: { '@type': 'Brand', name: p.brand || 'CSM Silks' },
            category: p.cat || undefined,
            image: imageList.filter(isImageAssetUrl).slice(0, 6),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'INR',
              price: activePrice,
              availability: canPurchase
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
              url: typeof window !== 'undefined' ? window.location.href : undefined,
              seller: { '@type': 'Organization', name: p.seller_name || 'CSM Silks Kanchipuram' },
            },
            ...(Number(p.review_count) > 0 && Number(p.avg_rating) > 0
              ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: Number(p.avg_rating).toFixed(1),
                    reviewCount: Number(p.review_count),
                  },
                }
              : {}),
          }),
        }}
      />

      <ProductStickyBar
        price={activePrice}
        inStock={canPurchase}
        onAddToCart={handleAddToCart}
        onBuyNow={() => void handleBuyNow()}
      />
    </div>
  );
}
