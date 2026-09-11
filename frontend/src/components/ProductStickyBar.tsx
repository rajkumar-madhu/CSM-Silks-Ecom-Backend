import { ShoppingBag, Zap } from 'lucide-react';
import { inr } from '@/lib/money';

type ProductStickyBarProps = {
  price: number;
  inStock: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
};

export function ProductStickyBar({ price, inStock, onAddToCart, onBuyNow }: ProductStickyBarProps) {
  return (
    <div className="pd-sticky-bar" aria-label="Quick purchase actions">
      <div className="pd-sticky-price">
        <span className="pd-sticky-label">Offer price</span>
        <strong>{inr(price)}</strong>
      </div>
      <div className="pd-sticky-actions">
        <button type="button" className="pd-sticky-cart" onClick={onAddToCart} disabled={!inStock} aria-label={inStock ? 'Add to cart from quick bar' : 'Sold out'}>
          <ShoppingBag size={18} />
          {inStock ? 'Add to cart' : 'Sold out'}
        </button>
        <button type="button" className="pd-sticky-buy" onClick={onBuyNow} disabled={!inStock} aria-label={inStock ? 'Buy now from quick bar' : 'Unavailable'}>
          <Zap size={18} />
          Buy now
        </button>
      </div>
    </div>
  );
}
