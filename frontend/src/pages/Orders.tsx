import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, MapPin, PackageOpen, RefreshCw, Route, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { inr } from '@/lib/money';
import { CUSTOMER_STATUS_CLASS, ORDER_STATUS_LABEL, formatDateTime, lifecycleProgress, trackingSummary } from '@/lib/orderLifecycle';
import { connectOrderRealtime, type RealtimeStatus } from '@/lib/realtime';
import { useApp } from '@/store/AppContext';
import { ProductVisual } from '@/ui/components';
import type { Order, PaginatedResponse } from '@/types';

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string; email?: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadRazorpayScript() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const ORDER_PAGE_SIZE = 10;
type OrderPageInfo = Pick<PaginatedResponse<Order>, 'total' | 'page' | 'per_page' | 'pages'>;

export function Orders() {
  const navigate = useNavigate();
  const { showToast, isAuthed } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{ order: Order; productSlug: string; productName: string } | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [pageInfo, setPageInfo] = useState<OrderPageInfo>({ total: 0, page: 1, per_page: ORDER_PAGE_SIZE, pages: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [returningOrderId, setReturningOrderId] = useState<number | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const loadOrdersPage = useCallback(async (page = 1, append = false, withSpinner = false) => {
    if (!isAuthed) {
      setOrders([]);
      setPageInfo({ total: 0, page: 1, per_page: ORDER_PAGE_SIZE, pages: 0 });
      setLoading(false);
      return;
    }
    if (withSpinner) setLoading(true);
    if (append) setLoadingMore(true);
    try {
      const data = await api.orders.list({ page, per_page: ORDER_PAGE_SIZE });
      setPageInfo({ total: data.total, page: data.page, per_page: data.per_page, pages: data.pages || 0 });
      setOrders(prev => {
        if (!append) return data.items;
        const known = new Set(prev.map(order => order.id));
        return [...prev, ...data.items.filter(order => !known.has(order.id))];
      });
    } catch (err) {
      if (!append) setOrders([]);
      showToast('!', 'Orders unavailable', err instanceof Error ? err.message : 'Unable to load orders');
    } finally {
      if (withSpinner) setLoading(false);
      if (append) setLoadingMore(false);
    }
  }, [isAuthed, showToast]);

  useEffect(() => {
    void Promise.resolve().then(() => loadOrdersPage(1, false, true));
    if (!isAuthed) return undefined;
    const timer = window.setInterval(() => void loadOrdersPage(1, false), 120000);
    return () => window.clearInterval(timer);
  }, [isAuthed, loadOrdersPage]);

  useEffect(() => {
    if (!isAuthed) {
      void Promise.resolve().then(() => setRealtimeStatus('unavailable'));
      return undefined;
    }
    return connectOrderRealtime('/ws/orders/', {
      onStatus: setRealtimeStatus,
      onMessage: message => {
        if (message.type !== 'order.update' || !message.order) return;
        setOrders(prev => {
          const exists = prev.some(order => order.id === message.order?.id);
          if (!exists) return [message.order as Order, ...prev];
          return prev.map(order => order.id === message.order?.id ? message.order as Order : order);
        });
        if (message.event) {
          showToast('LIVE', message.event.title, message.event.description || `${message.order.order_number} updated`);
        }
      },
    });
  }, [isAuthed, showToast]);

  const cancelOrder = async (order: Order) => {
    try {
      const updated = await api.orders.cancel(order.id);
      setOrders(prev => prev.map(item => item.id === updated.id ? updated : item));
      showToast('OK', 'Order cancelled', `${order.order_number} has been cancelled`);
    } catch (err) {
      showToast('!', 'Cancel failed', err instanceof Error ? err.message : 'Unable to cancel order');
    }
  };

  const requestReturn = async (order: Order) => {
    if (returningOrderId === order.id) return;
    setReturningOrderId(order.id);
    try {
      await api.returns.create({ order_id: order.id, reason: 'Customer return request', details: 'Return requested from account orders page.' });
      setOrders(prev => prev.map(item => item.id === order.id ? { ...item, status: 'return_initiated' } : item));
      showToast('OK', 'Return requested', `Return request created for ${order.order_number}`);
    } catch (err) {
      showToast('!', 'Return failed', err instanceof Error ? err.message : 'Unable to request return');
    } finally {
      setReturningOrderId(null);
    }
  };

  const retryPayment = async (order: Order) => {
    try {
      const rz = await api.payments.createRazorpayOrder(order.id);
      const razorpayKey = rz.key;
      if (!razorpayKey) throw new Error('Razorpay checkout is not configured. Please contact CSM Silks support.');
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) throw new Error('Unable to load Razorpay checkout');
      const RazorpayCtor = window.Razorpay as unknown as new (options: RazorpayOptions) => { open: () => void };
      await new Promise<void>((resolve, reject) => {
        new RazorpayCtor({
          key: razorpayKey,
          amount: rz.amount,
          currency: rz.currency,
          name: 'CSM Silks',
          description: order.order_number,
          order_id: rz.razorpay_order_id,
          prefill: { name: 'CSM Customer', contact: '' },
          handler: async (response) => {
            try {
              await api.payments.verify(response);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          modal: { ondismiss: () => reject(new Error('Payment was not completed')) },
          theme: { color: '#b9842e' },
        }).open();
      });
      const refreshed = await api.orders.get(order.id);
      setOrders(prev => prev.map(item => item.id === refreshed.id ? refreshed : item));
      showToast('OK', 'Payment confirmed', `${order.order_number} is confirmed`);
    } catch (err) {
      showToast('!', 'Payment retry failed', err instanceof Error ? err.message : 'Unable to retry payment');
    }
  };

  const downloadInvoice = async (order: Order) => {
    try {
      const blob = await api.orders.invoice(order.id);
      saveBlob(blob, `invoice-${order.order_number}.html`);
    } catch (err) {
      showToast('!', 'Invoice failed', err instanceof Error ? err.message : 'Unable to download invoice');
    }
  };

  const openReview = (order: Order) => {
    const first = order.items?.[0];
    const productSlug = first?.product?.slug;
    if (!productSlug) {
      showToast('!', 'Review unavailable', 'Product details are not attached to this order yet');
      return;
    }
    setReviewTarget({ order, productSlug, productName: first.product_name || first.product?.name || 'CSM product' });
    setReviewRating(5);
    setReviewTitle('');
    setReviewBody('');
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    if (!reviewTitle.trim()) {
      showToast('!', 'Review title required', 'Add a short title for your review');
      return;
    }
    setReviewSubmitting(true);
    try {
      await api.products.reviews.create(reviewTarget.productSlug, {
        rating: reviewRating,
        title: reviewTitle.trim(),
        body: reviewBody.trim() || 'No additional comments.',
      });
      showToast('OK', 'Review submitted', `Thanks for reviewing ${reviewTarget.productName}`);
      setReviewTarget(null);
    } catch (err) {
      showToast('!', 'Review failed', err instanceof Error ? err.message : 'Unable to submit review');
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (!isAuthed) {
    return (
      <div className="orders-page">
        <div className="orders-wrap">
          <h1 className="orders-title">My Orders</h1>
          <p className="orders-sub">Please sign in from Account to view your orders.</p>
          <button className="btn btn-gold" onClick={() => navigate('/account')}>Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="orders-page">
      <div className="orders-wrap">
        <div className="orders-heading-row">
          <div>
            <h1 className="orders-title">My Orders</h1>
            <p className="orders-sub">Track every admin and courier update from order placed to delivery</p>
          </div>
          <div className="orders-live-actions">
            <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live WebSocket' : realtimeStatus}</span>
            <button className="oc-btn oc-refresh" onClick={() => void loadOrdersPage(1, false)}>
              <RefreshCw size={14} /> Refresh logs
            </button>
          </div>
        </div>
        {loading && <div className="order-skeleton-list">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="order-skeleton" />)}</div>}
        {!loading && orders.length === 0 && (
          <div className="orders-empty">
            <PackageOpen size={54} />
            <h2>No orders yet</h2>
            <p>Start shopping and your confirmed, shipped, delivered, and return orders will be listed here.</p>
            <button className="btn btn-gold" onClick={() => navigate('/womens')}>Start shopping</button>
          </div>
        )}
        {orders.map(o => {
          const first = o.items?.[0];
          const p = first?.product;
          const summary = trackingSummary(o);
          const progress = lifecycleProgress(o);
          const eventCount = o.tracking_events?.length || 0;
          return (
            <div key={o.id} className="order-card" onClick={() => navigate(`/tracking/${o.id}`)}>
              <div className="oc-header">
                <span className="oc-id">#{o.order_number}</span>
                <span className={`oc-status ${CUSTOMER_STATUS_CLASS[o.status] || 'os-processing'}`}>{ORDER_STATUS_LABEL[o.status] || o.status}</span>
              </div>
              <div className="oc-body">
                <ProductVisual product={p} className="oc-img" />
                <div>
                  <div className="oc-name">{first?.product_name || 'CSM Silks order'}</div>
                  <div className="oc-meta">{new Date(o.created_at).toLocaleDateString('en-IN')} - {o.courier_name || 'Processing'}</div>
                </div>
                <div className="oc-price">{inr(o.total_amount)}</div>
              </div>
              <div className="oc-trace-panel">
                <div className="oc-trace-head">
                  <span><Clock3 size={14} /> Latest lifecycle log</span>
                  <small>{formatDateTime(summary.time)}</small>
                </div>
                <div className="oc-trace-main">
                  <strong>{summary.title}</strong>
                  <span>{summary.description}</span>
                  {summary.location && <em><MapPin size={12} /> {summary.location}</em>}
                </div>
                <div className="order-progress" aria-label="Order lifecycle progress">
                  {progress.map(stage => (
                    <div key={stage.key} className={`order-progress-step ${stage.state}`}>
                      <span />
                      <b>{stage.label}</b>
                    </div>
                  ))}
                </div>
                <div className="oc-trace-foot">
                  <span>{o.tracking_number ? `AWB ${o.tracking_number}` : 'AWB will appear after admin creates label'}</span>
                  <span>{eventCount} realtime log{eventCount === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="oc-actions">
                <button className="oc-btn oc-btn-track" onClick={(e) => { e.stopPropagation(); navigate(`/tracking/${o.id}`); }} aria-label={`Track order ${o.order_number}`}>
                  <Route size={14} /> Track lifecycle
                </button>
                {o.status === 'payment_pending' && (
                  <button className="oc-btn oc-btn-track" onClick={(e) => { e.stopPropagation(); void retryPayment(o); }} aria-label={`Retry payment for ${o.order_number}`}>
                    Retry Payment
                  </button>
                )}
                {o.status === 'delivered' && (
                  <button className="oc-btn oc-btn-review" onClick={(e) => { e.stopPropagation(); openReview(o); }} aria-label={`Review order ${o.order_number}`}>
                    Review
                  </button>
                )}
                {['pending', 'payment_pending', 'confirmed'].includes(o.status) && (
                  <button className="oc-btn oc-btn-cancel" onClick={(e) => { e.stopPropagation(); void cancelOrder(o); }} aria-label={`Cancel order ${o.order_number}`}>
                    Cancel
                  </button>
                )}
                {o.status === 'delivered' && (
                  <button className="oc-btn oc-btn-return" onClick={(e) => { e.stopPropagation(); void requestReturn(o); }} disabled={returningOrderId === o.id} aria-label={`Return order ${o.order_number}`}>
                    Return
                  </button>
                )}
                <button className="oc-btn oc-btn-invoice" onClick={(e) => { e.stopPropagation(); void downloadInvoice(o); }} aria-label={`Download invoice for ${o.order_number}`}>
                  Invoice
                </button>
              </div>
            </div>
          );
        })}
        {pageInfo.page < (pageInfo.pages || 0) && (
          <div className="orders-load-more">
            <span>Showing {orders.length} of {pageInfo.total} orders</span>
            <button className="oc-btn oc-refresh" onClick={() => void loadOrdersPage(pageInfo.page + 1, true)} disabled={loadingMore}>
              <RefreshCw size={14} /> {loadingMore ? 'Loading...' : 'Load more orders'}
            </button>
          </div>
        )}
      </div>
      {reviewTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setReviewTarget(null)}>
          <div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={event => event.stopPropagation()}>
            <div className="review-modal-head">
              <div>
                <span>Verified purchase</span>
                <h2 id="review-title">Review {reviewTarget.productName}</h2>
              </div>
              <button type="button" onClick={() => setReviewTarget(null)} aria-label="Close review form">x</button>
            </div>
            <div className="review-stars" aria-label="Rating">
              {Array.from({ length: 5 }).map((_, index) => {
                const value = index + 1;
                return (
                  <button key={value} type="button" className={value <= reviewRating ? 'on' : ''} onClick={() => setReviewRating(value)} aria-label={`${value} star${value === 1 ? '' : 's'}`}>
                    <Star size={22} fill="currentColor" />
                  </button>
                );
              })}
            </div>
            <div className="form-field">
              <label>Review title *</label>
              <input value={reviewTitle} onChange={event => setReviewTitle(event.target.value)} placeholder="Beautiful silk and fast delivery" />
            </div>
            <div className="form-field">
              <label>Review details</label>
              <textarea value={reviewBody} onChange={event => setReviewBody(event.target.value)} rows={4} placeholder="Tell other customers about fabric, zari, color, packing, and fit." />
            </div>
            <button className="btn btn-gold review-submit" type="button" onClick={() => void submitReview()} disabled={reviewSubmitting}>
              {reviewSubmitting ? 'Submitting...' : 'Submit review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
