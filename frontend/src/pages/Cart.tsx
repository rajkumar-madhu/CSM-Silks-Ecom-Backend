import { useCallback, useMemo, useState } from 'react';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { inr as fmt } from '@/lib/money';
import { useCatalogLiveRefresh } from '@/lib/useCatalogLiveRefresh';
import { ProductVisual } from '@/ui/components';
import { useApp } from '@/store/AppContext';

export function Cart() {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQty, getCartTotals, applyCoupon, removeCoupon, couponCode, refreshCart, showToast } = useApp();
  const [promo, setPromo] = useState(couponCode);
  const [applying, setApplying] = useState(false);
  const [stockNotice, setStockNotice] = useState('');
  const totals = getCartTotals();
  const stockIssues = cart.filter(item => item.stock_status && item.stock_status !== 'ok');
  const hasStockIssues = stockIssues.length > 0;
  const cartVariantIds = useMemo(() => new Set(cart.map(item => item.variant_id).filter(Boolean) as number[]), [cart]);
  const cartProductIds = useMemo(() => new Set(cart.map(item => item.id).filter(Boolean) as number[]), [cart]);

  const handleLiveStockUpdate = useCallback((message: Parameters<typeof useCatalogLiveRefresh>[0] extends { onUpdate: (msg: infer T) => void } ? T : never) => {
    const affectedVariant = message.variant_id || message.variant?.id;
    const affectedProduct = message.product_id || message.product?.id;
    if ((affectedVariant && cartVariantIds.has(affectedVariant)) || (affectedProduct && cartProductIds.has(affectedProduct))) {
      void refreshCart().then((data) => {
        const issueCount = data?.stock_issues?.length || 0;
        const text = issueCount ? `${issueCount} cart item needs stock attention.` : 'Cart stock refreshed from live inventory.';
        setStockNotice(text);
        showToast('LIVE', 'Cart stock refreshed', text);
      });
    }
  }, [cartProductIds, cartVariantIds, refreshCart, showToast]);

  const realtimeStatus = useCatalogLiveRefresh({
    enabled: cart.length > 0,
    onUpdate: handleLiveStockUpdate,
  });

  const handleApplyPromo = async () => {
    setApplying(true);
    try {
      await applyCoupon(promo);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="cart-page">
      <div className="cart-layout">
        <div>
          <div className="cart-title-row">
            <h1 className="cart-title">Shopping cart</h1>
            <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live stock' : realtimeStatus}</span>
          </div>
          {stockNotice && <div className="cart-live-line">{stockNotice}</div>}
          {hasStockIssues && (
            <div className="cart-stock-alert">
              {stockIssues[0].stock_message || 'One or more cart items need stock attention before checkout.'}
            </div>
          )}
          {cart.length === 0 ? (
            <div className="cart-empty">
              <ShoppingBag size={54} />
              <div className="cart-empty-title">Your cart is empty</div>
              <div className="cart-empty-sub">Browse the catalog and add a real SKU before checkout.</div>
              <button className="btn btn-primary" onClick={() => navigate('/womens')}>Shop women</button>
              <button className="btn btn-secondary" onClick={() => navigate('/mens')}>Shop men</button>
            </div>
          ) : (
            cart.map(item => {
              const availableQty = typeof item.variant_available_qty === 'number' ? item.variant_available_qty : undefined;
              const itemHasStockIssue = Boolean(item.stock_status && item.stock_status !== 'ok');
              return (
              <div key={`${item.id}-${item.variant_id}`} className={`cart-item ${itemHasStockIssue ? 'stock-warning' : ''}`}>
                <ProductVisual product={item} className="cart-visual" />
                <div className="ci-info">
                  <div className="ci-cat">{item.cat}</div>
                  <div className="ci-name">{item.name}</div>
                  <div className="ci-meta">
                    {item.gender === 'men' ? "Men's silk" : 'Pure Kanjivaram silk'} - {item.variant_sku || 'Selected SKU'}
                  </div>
                  <div className={`cart-stock-note ${itemHasStockIssue ? 'bad' : ''}`}>
                    {item.stock_message || (availableQty == null ? 'Live stock verified at checkout' : `${availableQty} units available`)}
                  </div>
                  <div className="ci-qty">
                    <button className="ci-qty-btn" onClick={() => void updateQty(item.cart_item_id || item.id, -1)} aria-label="Decrease quantity" disabled={item.qty <= 1}>
                      <Minus size={15} />
                    </button>
                    <span className="ci-qty-num">{item.qty}</span>
                    <button
                      className="ci-qty-btn"
                      onClick={() => void updateQty(item.cart_item_id || item.id, 1)}
                      aria-label="Increase quantity"
                      disabled={availableQty != null && item.qty >= availableQty}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                <div className="ci-right">
                  <div className="ci-price">{fmt(item.price * item.qty)}</div>
                  <button className="ci-remove" onClick={() => void removeFromCart(item.cart_item_id || item.id)}>
                    <Trash2 size={15} /> Remove
                  </button>
                </div>
              </div>
            );
            })
          )}
        </div>

        <aside className="order-summary">
          <div className="os-title">Order summary</div>
          <div className="os-row"><span>Subtotal</span><span>{fmt(totals.subtotal)}</span></div>
          {totals.discount > 0 && <div className="os-row"><span>Discount {couponCode ? `(${couponCode})` : ''}</span><span className="free">- {fmt(totals.discount)}</span></div>}
          <div className="os-row"><span>Shipping</span><span className={totals.shipping === 0 ? 'free' : ''}>{totals.shipping === 0 ? 'Free' : fmt(totals.shipping)}</span></div>
          <div className="os-row"><span>CGST (2.5%)</span><span>{fmt(totals.cgst)}</span></div>
          <div className="os-row"><span>SGST (2.5%)</span><span>{fmt(totals.sgst)}</span></div>
          <div className="os-row total"><span>Total</span><span>{fmt(totals.total)}</span></div>
          <div className="os-promo">
            <input className="os-promo-input" placeholder="Promo code" value={promo} onChange={event => setPromo(event.target.value.toUpperCase())} />
            <button className="os-promo-btn" onClick={() => void handleApplyPromo()} disabled={applying}>{applying ? '...' : 'Apply'}</button>
          </div>
          {couponCode && (
            <div className="applied-coupon">
              <span>Applied: {couponCode}</span>
              <button type="button" onClick={() => { setPromo(''); void removeCoupon(); }} aria-label="Remove coupon">x</button>
            </div>
          )}
          <button className="os-checkout-btn" onClick={() => navigate('/checkout')} disabled={cart.length === 0 || hasStockIssues}>
            {hasStockIssues ? 'Fix stock before checkout' : 'Proceed to checkout'}
          </button>
          <div className="os-guarantees">
            <div className="og">Free pan-India shipping</div>
            <div className="og">15-day easy returns</div>
            <div className="og">GST invoice included</div>
            <div className="og">Secure Razorpay payment</div>
          </div>
        </aside>
      </div>

      {cart.length > 0 && (
        <div className="mobile-action-bar" aria-label="Cart checkout actions">
          <div className="mobile-action-bar-inner">
            <div className="mobile-action-copy">
              <strong>{fmt(totals.total)}</strong>
              <small>{cart.length} item{cart.length === 1 ? '' : 's'} in bag</small>
            </div>
            <button
              type="button"
              className="mobile-action-btn"
              onClick={() => navigate('/checkout')}
              disabled={hasStockIssues}
            >
              {hasStockIssues ? 'Fix stock' : 'Checkout'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
