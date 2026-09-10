import { useParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
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
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Truck,
  Zap,
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
  getProductLengths,
  getProductSizes,
  getVariantStockForSize,
  lengthKey,
  resolveProductVariant,
  resolveVariantId,
} from '@/lib/variants';
import { useApp } from '@/store/AppContext';
import { SpinViewer } from '@/ui/components';
import type { Product, ProductReview } from '@/types';

type PdTab = 'details' | 'specs' | 'care' | 'shipping' | 'reviews';

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
  const [activeTab, setActiveTab] = useState<PdTab>('details');
  const [selectedLength, setSelectedLength] = useState('');
  const [showAllColors, setShowAllColors] = useState(false);
  // Ids the shopper has kept ticked in Frequently Bought Together. Seeded from the
  // suggestions once they arrive, so the default bundle is the full one.
  const [bundleOff, setBundleOff] = useState<number[]>([]);
  const [fabricOptions, setFabricOptions] = useState<string[]>([]);
  const [showAllOffers, setShowAllOffers] = useState(false);
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
        setSelectedLength(getProductLengths(item)[0] || '');
        setQuantity(1);
        setActiveTab('details');
        setShowAllColors(false);
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
      length: selectedLength || undefined,
    });
  }, [product, selectedColor, selectedSize, selectedLength]);

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

  // Silk type is a product-level attribute, not a per-variant switch, so the other
  // silk types are browse links rather than selectors. Sourced from the same facets
  // endpoint the listing page filters by; a failure just leaves the active chip alone.
  const facetGender = product?.gender;
  useEffect(() => {
    if (!facetGender) return;
    let cancelled = false;
    api.products.facets({ gender: facetGender })
      .then(facets => {
        if (!cancelled) setFabricOptions(facets.fabrics || []);
      })
      .catch(() => {
        if (!cancelled) setFabricOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [facetGender]);

  // Lengths this product genuinely records. One entry means the PDP states the
  // length as a fact; two or more turn it into a chooser.
  const lengthOptions = useMemo(() => {
    if (!product) return [];
    return getProductLengths(product).map(key => {
      const match = (product.variants || []).find(
        variant => variant.is_active !== false && lengthKey(variant.length_meters) === key,
      );
      return {
        key,
        price: Number(match?.price ?? product.price ?? 0),
        blouseIncluded: Boolean(match?.blouse_included),
      };
    });
  }, [product]);

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
  const activeImageIndex = Math.min(selectedThumb, Math.max(imageList.length - 1, 0));
  const mediaCount = Math.max(imageList.length, 1);

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
    variant_id: resolveVariantId(p, {
      size: selectedSize || undefined,
      colorIndex: selectedColor,
      length: selectedLength || undefined,
    }),
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

  const subtitle = (p.hook || '').trim();
  const ratingValue = Number(p.avg_rating || 0);
  const ratingCount = Number(p.review_count || 0);
  const careText = (activeVariant?.care_instructions || '').trim();
  const activeFabric = (activeVariant?.fabric || '').trim();

  // Coins are quoted with the server's own rate and the same truncation
  // orders/pricing.py applies, so the promise on the PDP is the credit at checkout.
  // No rate on the payload (older API) means no claim is made at all.
  const coinRate = Number(p.loyalty_points_per_rupee || 0);
  const coinsEarned = coinRate > 0 ? Math.floor(activePrice * coinRate) : 0;

  // Active silk type first, then the rest of the catalogue's silk types as browse
  // links. Deduplicated case-insensitively so "Pure Silk" and "Pure silk" are one chip.
  const silkTypes = (() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const name of [activeFabric, ...fabricOptions]) {
      const trimmed = (name || '').trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      list.push(trimmed);
    }
    return list;
  })();

  const activeLength = lengthOptions.find(option => option.key === selectedLength) || lengthOptions[0];
  const shortestLengthPrice = lengthOptions[0]?.price ?? activePrice;

  const colorSwatches = p.variants?.length
    ? p.variants
    : p.colors.map((hex, index) => ({ id: -1 - index, color_hex: hex, color_name: '' }));
  const COLOR_PREVIEW = 5;
  const hiddenColorCount = Math.max(0, colorSwatches.length - COLOR_PREVIEW);
  const visibleColors = showAllColors ? colorSwatches : colorSwatches.slice(0, COLOR_PREVIEW);
  const swatchImage = (variantId?: number) => {
    const images = variantId && variantId > 0 ? variantImageMap.get(variantId) : undefined;
    const first = images?.[0];
    return first && isImageAssetUrl(first) ? first : '';
  };

  // Bundle: this product plus the closest suggestions. The current item is always
  // part of it — the tick boxes only govern the add-ons.
  const bundleAddOns = relatedItems.slice(0, 2);
  const bundleChosen = bundleAddOns.filter(item => !bundleOff.includes(item.id));
  const bundleTotal = bundleChosen.reduce((sum, item) => sum + Number(item.price || 0), activePrice);
  const bundleMrpTotal = bundleChosen.reduce(
    (sum, item) => sum + Number(item.mrp || item.price || 0),
    activeMrp > activePrice ? activeMrp : activePrice,
  );
  const bundleSaving = Math.max(0, Math.round(bundleMrpTotal - bundleTotal));

  const offers = [
    p.deal_label || 'Special price',
    'Extra 5% off on prepaid orders',
    'Free shipping above Rs 999',
    `${p.return_days || 15}-day easy returns`,
  ];

  // `p.attribute_labels` is server-driven and lists every typed-attribute label —
  // including ones this product leaves null — so a key with a typed home never gets
  // "rescued" back into view here just because the typed row itself was omitted.
  const extraSpecs = (() => {
    const coveredLabels = new Set((p.attribute_labels || []).map(label => label.toLowerCase()));
    return Object.entries(p.specifications || {}).filter(
      ([key]) => !coveredLabels.has(key.toLowerCase()),
    );
  })();

  const sizedVariants = (p.variants || []).filter(variant => variant.size);
  const descBody = (p.description || '').trim();
  const hasStyling = Boolean(p.occasions?.length || p.tags?.length);

  const tabs = ([
    { key: 'details', label: 'Product Details', show: Boolean(descBody || hasStyling || p.key_highlights?.length) },
    { key: 'specs', label: 'Specifications', show: attrs.length > 0 || extraSpecs.length > 0 || sizedVariants.length > 0 },
    { key: 'care', label: 'Care Instructions', show: Boolean(careText) },
    { key: 'shipping', label: 'Shipping & Returns', show: true },
    { key: 'reviews', label: `Reviews (${ratingCount || reviews.length})`, show: true },
  ] as Array<{ key: PdTab; label: string; show: boolean }>).filter(tab => tab.show);
  // A tab can disappear between products (care text present on one, absent on the
  // next), so never leave the panel pointed at a tab that is no longer rendered.
  const currentTab: PdTab = tabs.some(tab => tab.key === activeTab) ? activeTab : (tabs[0]?.key || 'shipping');

  const addBundleToCart = async () => {
    if (canPurchase) await addToCart(buildCartProduct(), quantity);
    for (const item of bundleChosen) await addToCart(item, 1);
  };

  return (
    <div className="pd-page pd-flipkart">
      <div className="pd-shell">
        <nav className="pd-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="pd-crumb" onClick={() => navigate('/')}>Home</button>
          <span aria-hidden="true">/</span>
          <button type="button" className="pd-crumb" onClick={() => navigate(p.gender === 'men' ? '/mens' : '/womens')}>
            {p.gender === 'men' ? 'Men' : 'Women'}
          </button>
          <span aria-hidden="true">/</span>
          <button
            type="button"
            className="pd-crumb"
            onClick={() => navigate(`${p.gender === 'men' ? '/mens' : '/womens'}?category=${encodeURIComponent(p.category_slug || p.cat)}`)}
          >
            {p.cat}
          </button>
          <span aria-hidden="true">/</span>
          <span className="pd-crumb-current" aria-current="page">{p.name}</span>
        </nav>

        <div className="pd-grid">
          <div className="pd-gallery">
            <div className="pd-media-shell">
              <div className="pd-thumbs" role="group" aria-label="Product gallery">
                {imageList.map((value, i) => (
                  <button
                    type="button"
                    key={`${value}-${i}`}
                    className={`pd-thumb ${i === selectedThumb ? 'on' : ''}`}
                    style={isImageAssetUrl(value) ? { backgroundImage: `url(${value})` } : { background: value }}
                    onClick={() => setSelectedThumb(i)}
                    aria-label={`View product image ${i + 1}`}
                    aria-pressed={i === selectedThumb}
                  >
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {!isImageAssetUrl(value) && <strong>CSM</strong>}
                  </button>
                ))}
              </div>

              <div className="pd-media-stage">
                <div className="pd-main-img">
                  {p['badge-text'] && <span className="pd-media-badge">{p['badge-text']}</span>}
                  <button
                    type="button"
                    className={`pd-media-wish ${inWish ? 'on' : ''}`}
                    onClick={() => void toggleWishlist(p)}
                    aria-label={inWish ? 'Remove from wishlist' : 'Save to wishlist'}
                    aria-pressed={inWish}
                  >
                    <Heart size={18} fill={inWish ? 'currentColor' : 'none'} />
                  </button>
                  <SpinViewer
                    product={p}
                    images={imageList}
                    index={activeImageIndex}
                    onIndexChange={setSelectedThumb}
                  />
                  {disc > 0 && <span className="pd-gallery-off">{disc}% OFF</span>}
                </div>

                <div className="pd-media-meta">
                  <div>
                    <span className="pd-media-kicker">Visual edit</span>
                    <strong>Look {activeImageIndex + 1} of {mediaCount}</strong>
                  </div>
                  <div className="pd-media-pills">
                    <span>Tap thumbnails to switch views</span>
                    {selectedColorName && <span>{selectedColorName}</span>}
                    {selectedSize && <span>Size {selectedSize}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pd-info">
            <div className="pd-id-row">
              {p.is_featured && <span className="pd-exclusive"><Sparkles size={13} /> CSM Exclusive</span>}
              {p.assured && <span className="pd-badge pdb-assured"><BadgeCheck size={13} /> CSM Assured</span>}
              {p.is_gi_tagged && <span className="pd-badge pdb-blu">GI Tagged</span>}
              <span className={`ws-chip ${realtimeStatus}`}>{liveStatusLabel(realtimeStatus, 'stock')}</span>
              {activeVariant?.sku && <span className="pd-sku-tag">SKU: {activeVariant.sku}</span>}
            </div>

            <div className="pd-title-row">
              <h1 className="pd-title">{p.name}</h1>
              <button type="button" className="pd-icon-btn" onClick={() => void shareProduct()} aria-label="Share product">
                <Share2 size={17} />
              </button>
            </div>
            {subtitle && <p className="pd-subtitle">{subtitle}</p>}

            <div className="pd-rating">
              <span className="pd-stars" aria-hidden="true">
                {[1, 2, 3, 4, 5].map(star => (
                  <Star key={star} size={14} fill={star <= Math.round(ratingValue) ? 'currentColor' : 'none'} />
                ))}
              </span>
              <strong>{ratingValue.toFixed(1)}</strong>
              {ratingCount > 0 && <span className="pd-rating-count">({ratingCount.toLocaleString('en-IN')} Ratings)</span>}
              {reviews.length > 0 && (
                <button type="button" className="pd-rating-jump" onClick={() => setActiveTab('reviews')}>
                  {reviews.length} Reviews
                </button>
              )}
              {Number(p.total_sold) > 0 && (
                <span className="pd-sold"><Flame size={13} /> {Number(p.total_sold).toLocaleString('en-IN')} sold</span>
              )}
            </div>

            <div className="pd-price-panel">
              <div className="pd-price-row">
                <div className="pd-price">Rs {activePrice.toLocaleString('en-IN')}</div>
                {activeMrp > activePrice && <div className="pd-mrp">Rs {activeMrp.toLocaleString('en-IN')}</div>}
                {disc > 0 && <div className="pd-off">{disc}% OFF</div>}
              </div>
              <div className="pd-tax-note">Inclusive of all taxes</div>
            </div>

            {coinsEarned > 0 && (
              <div className="pd-coins">
                <span className="pd-coin-mark" aria-hidden="true" />
                Buy this product and earn {coinsEarned.toLocaleString('en-IN')} CSM Coins
              </div>
            )}

            <div className="pd-section-lbl">
              Color{selectedColorName ? <span className="pd-lbl-val"> : {selectedColorName}</span> : null}
            </div>
            <div className="pd-colors">
              {visibleColors.map((variant, i) => {
                const image = swatchImage(variant.id);
                return (
                  <button
                    type="button"
                    key={variant.id}
                    className={`pd-color ${i === selectedColor ? 'on' : ''} ${image ? 'has-img' : ''}`}
                    style={image
                      ? { backgroundImage: `url(${image})` }
                      : { background: variant.color_hex || p.colors[i] }}
                    onClick={() => {
                      setSelectedColor(i);
                      setSelectedThumb(0);
                    }}
                    aria-label={variant.color_name ? `Select colour ${variant.color_name}` : `Select colour ${i + 1}`}
                    aria-pressed={i === selectedColor}
                  />
                );
              })}
              {hiddenColorCount > 0 && !showAllColors && (
                <button type="button" className="pd-color-more" onClick={() => setShowAllColors(true)}>
                  +{hiddenColorCount}
                </button>
              )}
            </div>

            {silkTypes.length > 0 && (
              <>
                <div className="pd-section-lbl">
                  Silk Type{activeFabric ? <span className="pd-lbl-val"> : {activeFabric}</span> : null}
                </div>
                <div className="pd-chip-row">
                  {silkTypes.slice(0, 4).map(fabric => {
                    const isActive = fabric.toLowerCase() === activeFabric.toLowerCase();
                    return (
                      <button
                        type="button"
                        key={fabric}
                        className={`pd-opt ${isActive ? 'on' : ''}`}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => {
                          if (isActive) return;
                          navigate(`${p.gender === 'men' ? '/mens' : '/womens'}?fabrics=${encodeURIComponent(fabric)}`);
                        }}
                      >
                        {fabric}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {activeLength && (
              <>
                <div className="pd-section-lbl">
                  Length
                  <span className="pd-lbl-val">
                    {' '}: {activeLength.key} Meters{activeLength.blouseIncluded ? ' (With Blouse Piece)' : ''}
                  </span>
                </div>
                {lengthOptions.length > 1 && (
                  <div className="pd-chip-row">
                    {lengthOptions.map(option => {
                      const delta = Math.round(option.price - shortestLengthPrice);
                      return (
                        <button
                          type="button"
                          key={option.key}
                          className={`pd-opt ${option.key === activeLength.key ? 'on' : ''}`}
                          onClick={() => setSelectedLength(option.key)}
                          aria-pressed={option.key === activeLength.key}
                        >
                          {option.key} Meters{delta > 0 ? ` + Rs ${delta.toLocaleString('en-IN')}` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {sizeOptions.length > 0 && (
              <>
                <div className="pd-section-lbl">
                  Size{selectedSize ? <span className="pd-lbl-val"> : {selectedSize}</span> : null}
                </div>
                <div className="pd-size-row">
                  {sizeOptions.map(size => {
                    const stock = getVariantStockForSize(p, size, selectedColor);
                    return (
                      <button
                        type="button"
                        key={size}
                        className={`pd-size ${size === selectedSize ? 'on' : ''} ${stock <= 0 ? 'out' : ''}`}
                        onClick={() => setSelectedSize(size)}
                        disabled={stock <= 0}
                        aria-pressed={size === selectedSize}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

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

            <div className="pd-delivery-card">
              <div className="pd-delivery-title">
                <MapPin size={17} />
                Check Delivery &amp; Availability
                <span className={`pd-delivery-live ${deliveryStatus}`}>
                  {isChecking ? 'Checking' : deliveryStatus === 'ready' ? 'Live' : 'PIN check'}
                </span>
              </div>
              <form className="pd-pin-row" onSubmit={submitDeliveryCheck}>
                <input
                  value={pinCode}
                  onChange={event => setPinCode(event.target.value)}
                  placeholder="Enter Pincode"
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
              <div className="pd-delivery-facts">
                {/* Recorded per-product window, shown before any PIN is typed. */}
                {etaMin > 0 && etaMax > 0 && (
                  <span><Truck size={14} /> Usually delivered in {etaMin}–{etaMax} days</span>
                )}
                <span><CreditCard size={14} /> Free delivery on orders above Rs 999</span>
              </div>
              {delivery?.serviceable && (
                <div className="pd-delivery-perks">
                  {delivery.exchange_available && <span>Easy exchange</span>}
                  {delivery.return_days ? <span>{delivery.return_days}-day returns</span> : null}
                  {p.assured && <span>Quality checked dispatch</span>}
                </div>
              )}
            </div>

            <div className="pd-cta-row pd-desktop-cta">
              <button
                type="button"
                className={`pd-btn-wish ${inWish ? 'on' : ''}`}
                onClick={() => void toggleWishlist(p)}
                aria-pressed={inWish}
              >
                <Heart size={17} fill={inWish ? 'currentColor' : 'none'} />
                {inWish ? 'In Wishlist' : 'Add to Wishlist'}
              </button>
              <button type="button" className="pd-btn-cart" onClick={handleAddToCart} disabled={!canPurchase}>
                <ShoppingBag size={17} /> {canPurchase ? 'Add to Bag' : 'Sold out'}
              </button>
              <button type="button" className="pd-btn-buy" onClick={() => void handleBuyNow()} disabled={!canPurchase}>
                <Zap size={17} /> {canPurchase ? 'Buy Now' : 'Unavailable'}
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
          </div>

          <aside className="pd-rail" aria-label="Shopping help">
            <section className="pd-rail-card pd-rail-ai">
              <div className="pd-rail-ai-head">
                <Sparkles size={16} />
                <strong>AI Saree Finder</strong>
                <span className="pd-rail-new">New</span>
              </div>
              <p>Tell us the occasion and we will narrow the racks down for you.</p>
              <button type="button" className="pd-rail-cta" onClick={() => navigate('/tryon')}>
                Find My Saree <Sparkles size={15} />
              </button>
              {!!p.occasions?.length && (
                <div className="pd-rail-chips">
                  {p.occasions.slice(0, 3).map(occasion => (
                    <button
                      type="button"
                      key={occasion}
                      onClick={() => navigate(`${p.gender === 'men' ? '/mens' : '/womens'}?occasions=${encodeURIComponent(occasion)}`)}
                    >
                      {occasion}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="pd-rail-card">
              <h2 className="pd-rail-title">Offers</h2>
              <ul className="pd-rail-offers">
                {(showAllOffers ? offers : offers.slice(0, 3)).map(offer => (
                  <li key={offer}><Tag size={14} /> <span>{offer}</span></li>
                ))}
              </ul>
              {offers.length > 3 && (
                <button type="button" className="pd-rail-more" onClick={() => setShowAllOffers(open => !open)} aria-expanded={showAllOffers}>
                  {showAllOffers ? 'Show fewer offers' : `View All Offers (${offers.length})`}
                  <ChevronRight size={14} />
                </button>
              )}
            </section>

            <section className="pd-rail-card">
              <h2 className="pd-rail-title">Trusted by Thousands</h2>
              <div className="pd-rail-trust">
                <div><ShieldCheck size={18} /><span>100% Pure Silk Assured</span></div>
                <div><RotateCcw size={18} /><span>Easy {p.return_days || 15}-Day Returns</span></div>
                <div><Truck size={18} /><span>Free Shipping Above Rs 999</span></div>
                <div><CreditCard size={18} /><span>Secure Payments</span></div>
              </div>
            </section>
          </aside>
        </div>

        <div className={`pd-bottom ${relatedItems.length ? '' : 'solo'}`}>
          <div className="pd-bottom-main">
            <div className="pd-tabs" role="tablist" aria-label="Product information">
              {tabs.map(tab => (
                <button
                  type="button"
                  key={tab.key}
                  role="tab"
                  id={`pd-tab-${tab.key}`}
                  aria-selected={tab.key === currentTab}
                  aria-controls={`pd-panel-${tab.key}`}
                  className={`pd-tab ${tab.key === currentTab ? 'on' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="pd-tab-panel" role="tabpanel" id={`pd-panel-${currentTab}`} aria-labelledby={`pd-tab-${currentTab}`}>
              {currentTab === 'details' && (
                <>
                  {descBody && (() => {
                    // Only clamp when there is genuinely more to reveal — otherwise a short
                    // description gets a fade gradient laid over its final line for no reason.
                    const clampable = descBody.length > 260;
                    return (
                      <>
                        <div className={`pd-desc ${clampable ? 'clamped' : ''} ${descExpanded ? 'open' : ''}`}>
                          <p>{descBody}</p>
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

                  {hasStyling && (
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
                </>
              )}

              {currentTab === 'specs' && (
                <>
                  {attrs.length > 0 && (
                    <div className="pd-attrs">
                      {attrs.map(([label, value]) => (
                        <div key={label} className="pd-attr">
                          <div className="pda-l">{label}</div>
                          <div className="pda-v">{value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {extraSpecs.length > 0 && (
                    <div className="pd-spec-table">
                      {extraSpecs.map(([key, value]) => (
                        <div key={key}><span>{key}</span><strong>{value}</strong></div>
                      ))}
                    </div>
                  )}

                  {/* Size & fit is rendered strictly from recorded variant rows. There is no
                      measurement data on ProductVariant, so no cm/inch chart is shown rather
                      than a guessed one — same rule the attribute table follows. */}
                  {sizedVariants.length > 0 && (
                    <>
                      <div className="pd-section-lbl"><Ruler size={15} /> Size &amp; fit</div>
                      <div className="pd-fit-table">
                        <div className="pd-fit-head">
                          <span>Size</span><span>Fabric</span><span>Length</span><span>Availability</span>
                        </div>
                        {sizedVariants.map(variant => (
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
                </>
              )}

              {currentTab === 'care' && (
                <div className="pd-care">
                  <p>{careText}</p>
                  <div className="pd-guarantee">
                    <div className="pd-g">Quality checked before dispatch</div>
                    <div className="pd-g">Store folded in a cotton wrap, away from direct sun</div>
                  </div>
                </div>
              )}

              {currentTab === 'shipping' && (
                <div className="pd-ship">
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
                  <div className="pd-attrs">
                    {etaMin > 0 && etaMax > 0 && (
                      <div className="pd-attr">
                        <div className="pda-l">Dispatch window</div>
                        <div className="pda-v">{etaMin}–{etaMax} working days</div>
                      </div>
                    )}
                    <div className="pd-attr">
                      <div className="pda-l">Returns</div>
                      <div className="pda-v">{p.return_days || 15} days from delivery</div>
                    </div>
                    <div className="pd-attr">
                      <div className="pda-l">Cash on delivery</div>
                      <div className="pda-v">{p.cod_available ? 'Available' : 'Prepaid orders only'}</div>
                    </div>
                    <div className="pd-attr">
                      <div className="pda-l">Exchange</div>
                      <div className="pda-v">{p.exchange_available ? 'Supported' : 'Not available'}</div>
                    </div>
                  </div>
                  <div className="pd-seller">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>{delivery?.seller_name || p.seller_name || 'CSM Silks Kanchipuram'}</strong>
                      <span>{p.return_days || 15}-day returns, exchange support, GST invoice, and quality check before dispatch.</span>
                    </div>
                  </div>
                </div>
              )}

              {currentTab === 'reviews' && (
                <div className="pd-review-panel" id="reviews">
                  <div className="pd-review-head">
                    <strong>Ratings &amp; reviews</strong>
                    <span>{ratingValue.toFixed(1)} average</span>
                  </div>
                  {reviews.length > 0 ? (
                    <>
                      <div className="pd-rating-dist">
                        <div className="pd-rating-score">
                          <strong>{ratingValue.toFixed(1)}</strong>
                          <span className="pd-rating-stars" aria-hidden="true">
                            {[1, 2, 3, 4, 5].map(star => (
                              <Star key={star} size={13} fill={star <= Math.round(ratingValue) ? 'currentColor' : 'none'} />
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
                      {reviews.slice(0, 6).map(review => (
                        <div className="pd-review" key={review.id}>
                          <div><Star size={13} fill="currentColor" /> {review.rating}</div>
                          <strong>{review.title}</strong>
                          <p>{review.body}</p>
                          <span>{review.customer || 'Verified customer'} {review.is_verified_purchase ? '· verified purchase' : ''}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="pd-review-empty">No reviews recorded for this weave yet.</p>
                  )}
                </div>
              )}
            </div>

            {bundleAddOns.length > 0 && (
              <section className="pd-fbt" aria-labelledby="pd-fbt-title">
                <h2 id="pd-fbt-title">Frequently Bought Together</h2>
                <div className="pd-fbt-row">
                  <div className="pd-fbt-item">
                    <div
                      className="pd-fbt-img"
                      style={isImageAssetUrl(imageList[0]) ? { backgroundImage: `url(${imageList[0]})` } : { background: imageList[0] }}
                    />
                    <span className="pd-fbt-name">{p.name}</span>
                    <span className="pd-fbt-price">Rs {activePrice.toLocaleString('en-IN')}</span>
                    <span className="pd-fbt-this">This item</span>
                  </div>
                  {bundleAddOns.map(item => {
                    const picked = !bundleOff.includes(item.id);
                    const cover = (item.images || [])[0] || item.colors?.[0] || '';
                    return (
                      <label className={`pd-fbt-item pd-fbt-pick ${picked ? 'on' : ''}`} key={item.id}>
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => setBundleOff(off => (
                            picked ? [...off, item.id] : off.filter(id => id !== item.id)
                          ))}
                        />
                        <div
                          className="pd-fbt-img"
                          style={isImageAssetUrl(cover) ? { backgroundImage: `url(${cover})` } : { background: cover || 'var(--surface-2)' }}
                        />
                        <span className="pd-fbt-name">{item.name}</span>
                        <span className="pd-fbt-price">Rs {Number(item.price || 0).toLocaleString('en-IN')}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="pd-fbt-foot">
                  <div className="pd-fbt-total">
                    <span>Total for {bundleChosen.length + 1} item{bundleChosen.length ? 's' : ''}</span>
                    <strong>Rs {bundleTotal.toLocaleString('en-IN')}</strong>
                    {bundleSaving > 0 && <em>You save Rs {bundleSaving.toLocaleString('en-IN')}</em>}
                  </div>
                  <button type="button" className="pd-fbt-add" onClick={() => void addBundleToCart()} disabled={!canPurchase}>
                    <ShoppingBag size={16} /> Add {bundleChosen.length + 1} to Bag
                  </button>
                </div>
              </section>
            )}
          </div>

          {relatedItems.length > 0 && (
            <section className="pd-related" aria-labelledby="pd-related-title">
              <div className="pd-related-head">
                {/* Only claim the category when every card actually belongs to it —
                    the rail tops up from the same gender when the category is thin. */}
                <h2 id="pd-related-title">
                  {relatedItems.every(item => item.cat === p.cat) ? `More from ${p.cat}` : 'You May Also Like'}
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
        </div>
      </div>

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
