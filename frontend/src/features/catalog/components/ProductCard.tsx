import { Heart, ShoppingBag, Star, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getDeliveryPin } from '@/lib/deliveryPin';
import { productDetailPath } from '@/lib/productPaths';
import { resolveAssetUrl } from '@/lib/api';
import { inr } from '@/lib/money';
import { ProductVisual } from '@/ui/components';
import { useApp } from '@/store/AppContext';
import type { Product } from '@/types';

interface ProductCardProps {
  product: Product;
  layout?: 'default' | 'retail' | 'nykaa';
}

// Low enough that the badge is a genuine "only a few left" signal rather than decoration.
const LOW_STOCK_BADGE_THRESHOLD = 3;

function colorNames(product: Product) {
  const fromVariants = (product.variants || [])
    .map(variant => variant.color_name?.trim())
    .filter((name): name is string => Boolean(name));
  // Deliberately no fabricated "Color 1/2/3" fallback: a product whose variants carry
  // no color_name shows unlabelled swatches rather than placeholder text.
  return fromVariants.length ? [...new Set(fromVariants)].slice(0, 4) : [];
}

export function ProductCard({ product, layout = 'default' }: ProductCardProps) {
  const { addToCart, toggleWishlist, isInWishlist } = useApp();
  const inWish = isInWishlist(product.id);
  const rating = Number(product.avg_rating || 0);
  const discount = product.mrp ? Math.max(0, Math.round((1 - product.price / product.mrp) * 100)) : 0;
  const stock = Number(product.available_qty || 0);
  const canBuy = stock > 0;
  const deliveryPin = getDeliveryPin();
  const deliveryDays = `${product.delivery_min_days || 2}-${product.delivery_max_days || 6}`;
  const href = productDetailPath(product);
  const secondaryImage = resolveAssetUrl(product.images?.[1]);
  // Scarcity comes from stock alone. `deal_label` used to trigger this too, but it holds
  // merchandising copy ("Festive Price Drop", "Bank Offer Eligible", "Rare Weave") that says
  // nothing about how fast a saree is moving — and every product carries one, so the badge
  // showed on 100% of the catalogue and meant nothing.
  const sellingFast = stock > 0 && stock <= LOW_STOCK_BADGE_THRESHOLD;
  const colors = colorNames(product);
  const swatches = (product.colors || []).slice(0, 4);

  if (layout === 'nykaa') {
    return (
      <article className="product-card product-card--nykaa">
        <div className="product-card-media">
          <Link to={href} className="product-card-media-link" tabIndex={-1} aria-hidden="true">
            <ProductVisual product={product} />
            {secondaryImage && (
              <img className="product-card-hover-photo" src={secondaryImage} alt="" aria-hidden="true" loading="lazy" />
            )}
          </Link>
          {rating > 0 && (
            <span className="nykaa-rating-pill">
              {rating.toFixed(1)} <Star size={11} fill="currentColor" />
              {product.review_count ? <em>| {product.review_count}</em> : null}
            </span>
          )}
          {sellingFast && <span className="nykaa-fast">Selling fast</span>}
          <button
            type="button"
            className={`product-wish ${inWish ? 'active' : ''}`}
            aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
            onClick={() => {
              void toggleWishlist(product);
            }}
          >
            <Heart size={16} fill={inWish ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="nykaa-quick-shop"
            disabled={!canBuy}
            onClick={() => {
              if (!canBuy) return;
              void addToCart(product);
            }}
          >
            <ShoppingBag size={14} /> {canBuy ? 'Add to bag' : 'Sold out'}
          </button>
        </div>
        <Link to={href} className="product-card-link nykaa-body">
          <strong className="nykaa-brand">{product.brand || 'CSM Silks'}</strong>
          <span className="nykaa-name">{product.name}</span>
          <span className="nykaa-price-line">
            {product.mrp > product.price ? (
              <>
                <span className="sr-only">
                  Regular price Rupees {product.mrp.toLocaleString('en-IN')}, sale price Rupees{' '}
                  {product.price.toLocaleString('en-IN')}
                </span>
                <strong aria-hidden="true">{inr(product.price)}</strong>
                <s aria-hidden="true">{inr(product.mrp)}</s>
                {discount > 0 && <em aria-hidden="true">({discount}% Off)</em>}
              </>
            ) : (
              <strong>{inr(product.price)}</strong>
            )}
          </span>
        </Link>
      </article>
    );
  }

  if (layout === 'retail') {
    return (
      <article className="product-card product-card--retail">
        <div className="product-card-media">
          <Link to={href} className="product-card-media-link" tabIndex={-1} aria-hidden="true">
            <ProductVisual product={product} />
            {secondaryImage && (
              <img className="product-card-hover-photo" src={secondaryImage} alt="" aria-hidden="true" loading="lazy" />
            )}
          </Link>
          {sellingFast && <span className="product-fast">Selling fast</span>}
          <button
            type="button"
            className="product-quick-shop"
            disabled={!canBuy}
            onClick={() => {
              if (!canBuy) return;
              void addToCart(product);
            }}
          >
            Quick shop
          </button>
          <button
            type="button"
            className={`product-wish ${inWish ? 'active' : ''}`}
            aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
            onClick={() => {
              void toggleWishlist(product);
            }}
          >
            <Heart size={16} fill={inWish ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="product-card-body">
          <Link to={href} className="product-card-link">
            <div className="product-card-price-line">
              {product.mrp > product.price ? (
                <>
                  <span className="sr-only">
                    Regular price Rupees {product.mrp.toLocaleString('en-IN')}, sale price Rupees{' '}
                    {product.price.toLocaleString('en-IN')}
                  </span>
                  <strong aria-hidden="true">{inr(product.price)}</strong>
                  <s aria-hidden="true" className="product-mrp-inline">
                    {inr(product.mrp)}
                  </s>
                  {discount > 0 && (
                    <span aria-hidden="true" className="product-price-off">{discount}% off</span>
                  )}
                </>
              ) : (
                <strong>{inr(product.price)}</strong>
              )}
            </div>
            <h3>{product.name}</h3>
            {swatches.length > 0 && (
              <div
                className="product-card-swatches"
                aria-label={colors.length ? `Colors: ${colors.join(', ')}` : 'Available colors'}
              >
                {swatches.map((color, index) => (
                  <span key={color} style={{ background: color }} title={colors[index]} />
                ))}
              </div>
            )}
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="product-card">
      <div className="product-card-media">
        <Link to={href} className="product-card-media-link" tabIndex={-1} aria-hidden="true">
          <ProductVisual product={product} />
        </Link>
        <button
          type="button"
          className={`product-wish ${inWish ? 'active' : ''}`}
          aria-label={inWish ? 'Remove from wishlist' : 'Add to wishlist'}
          onClick={() => {
            void toggleWishlist(product);
          }}
        >
          <Heart size={17} fill={inWish ? 'currentColor' : 'none'} />
        </button>
        {product.assured && <span className="product-assured">Assured</span>}
        {discount > 0 && <span className="product-discount">{discount}% off</span>}
      </div>
      <div className="product-card-body">
        <Link to={href} className="product-card-link">
          <div className="product-card-meta">
            <span>{product.cat}</span>
            <span className="product-rating">
              <Star size={12} fill="currentColor" />
              {rating ? rating.toFixed(1) : 'New'}
              {product.review_count ? ` (${product.review_count})` : ''}
            </span>
          </div>
          <h3>{product.name}</h3>
          <p>{product.hook || 'Pure silk textile from CSM Silks.'}</p>
          <div className="product-card-swatches" aria-label="Available colors">
            {(product.colors || []).slice(0, 4).map(color => <span key={color} style={{ background: color }} />)}
          </div>
          <div className="product-card-flags">
            {product.deal_label && <span className="product-flag gold">{product.deal_label}</span>}
            <span className={`product-flag ${stock > 0 ? '' : 'danger'}`}>{stock > 0 ? `${stock} left` : 'Sold out'}</span>
          </div>
          <div className="product-delivery-line">
            <Truck size={13} />
            Delivery to {deliveryPin} in {deliveryDays} days
          </div>
        </Link>
        <div className="product-card-bottom">
          <Link to={href} className="product-card-price-link">
            <div className="product-price">{inr(product.price)}</div>
            {product.mrp > product.price && <div className="product-mrp">{inr(product.mrp)}</div>}
          </Link>
          <button
            type="button"
            className="product-cart"
            aria-label="Add to cart"
            disabled={!canBuy}
            onClick={() => {
              if (!canBuy) return;
              void addToCart(product);
            }}
          >
            <ShoppingBag size={16} /> {canBuy ? 'Add' : 'Sold out'}
          </button>
        </div>
      </div>
    </article>
  );
}
