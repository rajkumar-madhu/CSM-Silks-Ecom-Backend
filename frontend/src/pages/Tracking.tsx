import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Clock3, ExternalLink, MessageCircle, PackageCheck, Phone, RefreshCw, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { inr } from '@/lib/money';
import { STORE_PHONE_TEL, STORE_WHATSAPP_URL } from '@/lib/storeContact';
import { ORDER_STATUS_LABEL, formatDateTime, latestTrackingEvent, lifecycleProgress, sortTrackingEvents } from '@/lib/orderLifecycle';
import { connectOrderRealtime, type RealtimeStatus } from '@/lib/realtime';
import { useApp } from '@/store/AppContext';
import { ProductVisual } from '@/ui/components';
import type { Order, TrackingEvent } from '@/types';

export function Tracking() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { showToast } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [lookupIdentifier, setLookupIdentifier] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const defaultLookupId = orderId?.startsWith('CSM-') ? orderId : '';

  const fetchOrder = useCallback(async (withSpinner = false) => {
    if (!orderId) return;
    if (withSpinner) setLoading(true);
    try {
      if (api.tokens.getAccessToken()) {
        const result = await api.orders.get(orderId);
        setOrder(result);
        setLookupError('');
        setLastRefreshed(new Date().toISOString());
        return;
      }
      setOrder(null);
      setLookupError('Sign in to view this order, or track with order number and phone below.');
    } catch {
      if (api.tokens.getAccessToken()) {
        setOrder(null);
      } else {
        setLookupError('Sign in to view this order, or track with order number and phone below.');
      }
    } finally {
      if (withSpinner) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    if (!orderId) return undefined;
    void Promise.resolve().then(() => {
      if (active) void fetchOrder(true);
    });
    const timer = window.setInterval(() => {
      if (active) void fetchOrder(false);
    }, 120000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [orderId, fetchOrder]);

  useEffect(() => {
    if (!order?.id || !api.tokens.getAccessToken()) {
      void Promise.resolve().then(() => setRealtimeStatus('unavailable'));
      return undefined;
    }
    return connectOrderRealtime(`/ws/orders/${order.id}/`, {
      onStatus: setRealtimeStatus,
      onMessage: message => {
        if (message.type !== 'order.update' || !message.order || message.order.id !== order.id) return;
        setOrder(message.order);
        setLastRefreshed(message.timestamp || new Date().toISOString());
        if (message.event) {
          showToast('LIVE', message.event.title, message.event.description || 'Order tracking updated');
        }
      },
    });
  }, [order?.id, showToast]);

  const trackOrder = async (event: FormEvent) => {
    event.preventDefault();
    const identifier = (lookupIdentifier || defaultLookupId).trim();
    const phone = lookupPhone.trim();
    if (!identifier || !phone) {
      setLookupError('Order number/AWB and phone are required');
      return;
    }
    setLookupLoading(true);
    setLookupError('');
    try {
      const tracked = await api.orders.track(identifier, phone);
      setOrder(tracked);
      setLastRefreshed(new Date().toISOString());
    } catch (err) {
      setOrder(null);
      setLookupError(err instanceof Error ? err.message : 'No matching order found');
    } finally {
      setLookupLoading(false);
    }
  };

  const resetTracking = () => {
    setOrder(null);
    setLookupIdentifier('');
    setLookupPhone('');
    setLookupError('');
    navigate('/tracking', { replace: true });
  };

  const lookupCard = (
    <form className="track-lookup-card" onSubmit={trackOrder}>
      <div>
        <span className="track-kicker">Track package</span>
        <h1>Order tracking</h1>
      </div>
      <div className="track-lookup-grid">
        <label>Order number / AWB<input value={lookupIdentifier || defaultLookupId} onChange={e => setLookupIdentifier(e.target.value)} placeholder="Enter order number or AWB" /></label>
        <label>Phone<input value={lookupPhone} onChange={e => setLookupPhone(e.target.value)} placeholder="+91..." /></label>
        <button className="btn btn-gold" type="submit" disabled={lookupLoading}>{lookupLoading ? 'Tracking...' : 'Track order'}</button>
      </div>
      {lookupError && <div className="track-error">{lookupError}</div>}
    </form>
  );

  if (loading) {
    return <div className="tracking-page"><div className="tracking-wrap">Loading tracking...</div></div>;
  }

  if (!order) {
    return (
      <div className="tracking-page">
        <div className="tracking-wrap">
          {orderId && (
            <div className="track-empty">
              <div className="track-empty-mark">CSM</div>
              <h2>Order not found</h2>
              <button className="btn btn-gold" onClick={() => navigate('/orders')}>Back to Orders</button>
            </div>
          )}
          {lookupCard}
        </div>
      </div>
    );
  }

  const first = order.items?.[0];
  const p = first?.product;
  const isDelivered = order.status === 'delivered';
  const events = sortTrackingEvents(order.tracking_events || []);
  const progress = lifecycleProgress(order);
  const lastEvent = latestTrackingEvent(order);
  const currentStatus = ORDER_STATUS_LABEL[order.status] || order.status.replaceAll('_', ' ');

  const steps = events.map((trackingEvent: TrackingEvent, index) => ({
    title: trackingEvent.title,
    desc: [trackingEvent.description, trackingEvent.location].filter(Boolean).join(' - '),
    time: formatDateTime(trackingEvent.happened_at),
    status: index < events.length - 1 || trackingEvent.status === 'delivered' ? 'done' : 'act',
  }));

  return (
    <div className="tracking-page">
      <div className="tracking-wrap">
        <button type="button" className="track-back" onClick={() => navigate('/orders')}>
          <ArrowLeft size={18} />
          <span>Orders</span>
        </button>

        <div className="track-header">
          <div className="track-id-row">
            <span className="track-id">#{order.order_number}</span>
            <span className="track-eta">{isDelivered ? 'Delivered' : order.estimated_delivery ? `Expected: ${new Date(order.estimated_delivery).toLocaleDateString('en-IN')}` : 'Expected date pending'}</span>
          </div>
          <div className="track-prod-row">
            <ProductVisual product={p} className="track-img" />
            <div>
              <div className="track-pname">{first?.product_name || 'CSM Silks order'}</div>
              <div className="track-pmeta">Qty: {first?.quantity || 1} / {order.payment_method || 'payment'} / {order.payment_status || 'payment status pending'}</div>
            </div>
            <div className="track-pprice">{inr(order.total_amount)}</div>
          </div>
        </div>

        <div className={`track-status-card ${isDelivered ? 'tsc-delivered' : 'tsc-transit'}`}>
          <div className="tsc-icon">{isDelivered ? <PackageCheck size={24} /> : <Truck size={24} />}</div>
          <div>
            <div className="tsc-status">{currentStatus}</div>
            <div className="tsc-desc">{lastEvent?.description || order.courier_name || 'Courier will be assigned by admin'}</div>
            <div className="track-meta-grid">
              <span><Truck size={13} /> {order.courier_name || 'Courier pending'}</span>
              <span><PackageCheck size={13} /> {order.tracking_number || 'AWB pending'}</span>
              <span><Clock3 size={13} /> {realtimeStatus === 'connected' ? 'Live WebSocket connected' : lastRefreshed ? `Synced ${formatDateTime(lastRefreshed)}` : 'Live sync ready'}</span>
            </div>
          </div>
          <button className="track-refresh-btn" onClick={() => void fetchOrder(false)}><RefreshCw size={14} /> Refresh</button>
        </div>

        <div className="track-progress-card">
          {progress.map(stage => (
            <div key={stage.key} className={`track-progress-step ${stage.state}`}>
              <span>{stage.state === 'done' ? <Check size={13} /> : null}</span>
              <div>
                <b>{stage.label}</b>
                <small>{stage.description}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="track-timeline">
          <div className="track-section-head">
            <div>
              <span className="track-kicker">Realtime event log</span>
              <div className="tl-title">Order Timeline</div>
            </div>
            <small>{events.length} event{events.length === 1 ? '' : 's'} recorded</small>
          </div>
          {steps.map((s, i) => (
            <div key={i} className={`tl-item ${s.status}`}>
              <div className="tl-left">
                <div className="tl-dot">{s.status === 'done' ? <Check size={13} /> : s.status === 'act' ? <Clock3 size={13} /> : ''}</div>
                {i < steps.length - 1 && <div className="tl-line" />}
              </div>
              <div className="tl-right">
                <div className="tl-step-title">{s.title}</div>
                <div className="tl-step-desc">{s.desc}</div>
                {s.time && <div className="tl-time">{s.time}</div>}
              </div>
            </div>
          ))}
          {!steps.length && (
            <div className="track-empty-events">
              No tracking event has been recorded yet. Admin workflow or courier webhook updates will appear here live.
            </div>
          )}
        </div>

        <div className="track-support-actions">
          <button className="btn btn-ghost" onClick={resetTracking}>Track another order</button>
          <a className="btn btn-ghost" href={`tel:${STORE_PHONE_TEL}`}><Phone size={14} /> Call Support</a>
          {order.tracking_url && <a className="btn btn-ghost" href={order.tracking_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open courier tracking</a>}
          <a className="btn btn-wa" href={`${STORE_WHATSAPP_URL}?text=Hi!%20I%20need%20help%20with%20order%20${order.order_number}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp Support</a>
        </div>
      </div>
    </div>
  );
}
