import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BadgePercent,
  Boxes,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  IndianRupee,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { AdminCatalogManager } from '@/features/admin/components/AdminCatalogManager';
import { AdminChoice } from '@/features/admin/components/AdminChoice';
import { DashboardInsights } from '@/features/admin/components/DashboardInsights';
import { useAdminBadges, type AdminBadgeCounts } from '@/features/admin/useAdminBadges';
import { ADMIN_STATUS_CLASS, ORDER_STATUS_LABEL, formatDateTime, latestTrackingEvent, lifecycleProgress, sortTrackingEvents } from '@/lib/orderLifecycle';
import { useCatalogLiveRefresh } from '@/lib/useCatalogLiveRefresh';
import { connectOrderRealtime, type RealtimeStatus } from '@/lib/realtime';
import { useApp } from '@/store/AppContext';
import type { AdminAuditLog, AdminCoupon, AdminInventoryRow, AdminReview, AdminShipment, Order, PaginatedResponse, ReturnRequest, User } from '@/types';

type AdminPage = 'dashboard' | 'orders' | 'products' | 'inventory' | 'shipments' | 'coupons' | 'returns' | 'customers' | 'reports' | 'audit' | 'unsold' | 'reviews';
type Kpis = Record<string, number | string>;
type AdminOrderRow = Partial<Order> & {
  id: number;
  order_number?: string;
  customer?: string;
  total?: number | string;
  shipping_address_snapshot?: { full_name?: string };
  created_at?: string;
  status?: string;
};
type DashboardData = { kpis: Kpis; recent_orders: AdminOrderRow[] };
type CustomerRow = { id: number; name?: string; phone?: string; email?: string; orders?: number; spent?: number | string; tier?: string };
type ReportData = Record<string, number | string | undefined>;
type UnsoldRow = { id: number; product_name?: string; sku?: string; stock_qty?: number; days_unsold?: number; capital_blocked?: number | string; severity?: string };
type UnsoldData = { count: number; items: UnsoldRow[] };
type WorkflowPayload = { action: string; provider: string; location: string; note: string };
type OrderPageInfo = Pick<PaginatedResponse<Order>, 'total' | 'page' | 'per_page' | 'pages'>;

const ADMIN_ORDER_PAGE_SIZE = 25;
const ADMIN_PAGE_HASH: Record<string, AdminPage> = {
  dashboard: 'dashboard',
  orders: 'orders',
  products: 'products',
  catalog: 'products',
  inventory: 'inventory',
  shipments: 'shipments',
  coupons: 'coupons',
  returns: 'returns',
  customers: 'customers',
  reports: 'reports',
  audit: 'audit',
  reviews: 'reviews',
  unsold: 'unsold',
};

function pageFromHash(): AdminPage {
  const key = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return ADMIN_PAGE_HASH[key] || 'dashboard';
}

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

function isAdminUser(user?: User | null) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

function adminStatusClass(status?: string) {
  return ADMIN_STATUS_CLASS[status as Order['status']] || 'st-processing';
}

const workflowActions = [
  ['confirm', 'Confirm order'],
  ['quality_check', 'Start quality check'],
  ['pack', 'Mark packed'],
  ['create_label', 'Create label / AWB'],
  ['pickup', 'Courier picked up'],
  ['in_transit', 'In transit'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['delivery_failed', 'Delivery failed'],
  ['rto_initiated', 'Return to origin'],
  ['rto_delivered', 'RTO delivered'],
  ['cancel', 'Cancel order'],
] as const;

type WorkflowAction = typeof workflowActions[number][0];

function workflowActionOptions(order: Order) {
  const allowedByStatus: Partial<Record<Order['status'], WorkflowAction[]>> = {
    pending: ['cancel'],
    payment_pending: ['cancel'],
    confirmed: ['quality_check', 'pack', 'create_label', 'cancel'],
    quality_check: ['pack', 'create_label'],
    packed: ['create_label', 'pickup', 'in_transit'],
    shipped: ['in_transit', 'out_for_delivery', 'delivery_failed', 'rto_initiated'],
    out_for_delivery: ['delivered', 'delivery_failed', 'rto_initiated'],
    delivery_failed: ['rto_initiated'],
    rto_initiated: ['rto_delivered'],
  };
  const allowed = allowedByStatus[order.status] || [];
  return workflowActions.filter(([action]) => allowed.includes(action));
}

function nextWorkflowAction(order: Order): WorkflowAction {
  const latest = latestTrackingEvent(order);
  if (order.status === 'pending' || order.status === 'payment_pending') return 'cancel';
  if (order.status === 'confirmed') return 'quality_check';
  if (order.status === 'quality_check') return 'pack';
  if (order.status === 'packed') return order.tracking_number ? 'pickup' : 'create_label';
  if (order.status === 'shipped') return latest?.status === 'in_transit' ? 'out_for_delivery' : 'in_transit';
  if (order.status === 'out_for_delivery') return 'delivered';
  if (order.status === 'delivery_failed') return 'rto_initiated';
  if (order.status === 'rto_initiated') return 'rto_delivered';
  return 'cancel';
}

function defaultWorkflowNote(action: string) {
  const notes: Record<string, string> = {
    confirm: 'Order confirmed by CSM operations.',
    quality_check: 'Silk quality check started before packing.',
    pack: 'Order packed and ready for courier handover.',
    create_label: 'Shipping label created and package is ready for handover.',
    pickup: 'Package handed over to courier partner.',
    in_transit: 'Package is moving through the courier network.',
    out_for_delivery: 'Package is with the delivery partner.',
    delivered: 'Order delivered to customer.',
    delivery_failed: 'Delivery attempt failed. Customer follow-up required.',
    rto_initiated: 'Courier started return to origin.',
    rto_delivered: 'Package returned to CSM Silks.',
    cancel: 'Order cancelled by operations team.',
  };
  return notes[action] || 'Order lifecycle updated by CSM operations.';
}

function defaultWorkflowForm(order: Order): WorkflowPayload {
  const action = nextWorkflowAction(order);
  return {
    action,
    provider: order.courier_name || 'manual',
    location: order.status === 'out_for_delivery' ? 'Customer delivery area' : 'CSM Kanchipuram operations',
    note: defaultWorkflowNote(action),
  };
}

function formatAdminMoney(value: number | string | undefined) {
  return `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatAdminNumber(value: number | string | undefined) {
  return Number(value || 0).toLocaleString('en-IN');
}

type AdminNavItem = {
  key: AdminPage;
  label: string;
  icon: typeof BarChart3;
  /** Which live count, if any, this item badges. Tone drives the badge colour. */
  badge?: { count: number; tone: 'warn' | 'alert' | 'info'; noun: string };
};

const RAIL_STORAGE_KEY = 'csm.admin.sidebar-railed';
// Below this the sidebar stops being a column and becomes an off-canvas drawer. Matches the
// breakpoint in admin.css — change both together or the drawer opens behind a visible column.
const NAV_DRAWER_MAX_WIDTH = 1080;

function readRailPreference(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function badgeFor(count: number | undefined, tone: 'warn' | 'alert' | 'info', noun: string) {
  return count && count > 0 ? { count, tone, noun } : undefined;
}

/**
 * The three groups mirror how the shop actually works rather than how the API is organised:
 * Floor is what is moving today, Catalog is what is on the shelf, House is everything that
 * reviews the first two after the fact.
 */
function buildNavGroups(badges: AdminBadgeCounts): Array<{ label: string; hint: string; items: AdminNavItem[] }> {
  return [
    {
      label: 'Floor',
      hint: 'Moving today',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { key: 'orders', label: 'Orders', icon: ShoppingBag, badge: badgeFor(badges.orders, 'warn', 'orders awaiting action') },
        { key: 'shipments', label: 'Shipments', icon: Truck },
        { key: 'returns', label: 'Returns', icon: RotateCcw, badge: badgeFor(badges.returns, 'warn', 'open returns') },
      ],
    },
    {
      label: 'Catalog',
      hint: 'On the shelf',
      items: [
        { key: 'products', label: 'Catalog', icon: Boxes },
        { key: 'inventory', label: 'Inventory', icon: PackageCheck },
        { key: 'unsold', label: 'Stock alerts', icon: AlertTriangle, badge: badgeFor(badges.unsold, 'alert', 'unresolved stock alerts') },
        { key: 'coupons', label: 'Coupons', icon: BadgePercent },
      ],
    },
    {
      label: 'House',
      hint: 'Pulse & oversight',
      items: [
        { key: 'customers', label: 'Customers', icon: Users },
        { key: 'reviews', label: 'Reviews', icon: Star, badge: badgeFor(badges.reviews, 'info', 'reviews held back from the storefront') },
        { key: 'reports', label: 'Reports', icon: FileText },
        { key: 'audit', label: 'Audit', icon: ShieldCheck },
      ],
    },
  ];
}

function AdminNavBadge({ badge, label }: { badge: NonNullable<AdminNavItem['badge']>; label: string }) {
  return (
    <span className={`admin-nav-badge admin-nav-badge-${badge.tone}`} title={`${badge.count} ${badge.noun}`}>
      <span aria-hidden="true">{badge.count > 99 ? '99+' : badge.count}</span>
      <span className="sr-only">{`${label}: ${badge.count} ${badge.noun}`}</span>
    </span>
  );
}

export function Admin() {
  const { refreshSession } = useApp();
  const [page, setPage] = useState<AdminPage>(() => pageFromHash());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(api.tokens.getAccessToken()));
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [railed, setRailed] = useState(readRailPreference);
  const { counts: badgeCounts, refresh: refreshBadges } = useAdminBadges(authed);

  const navigatePage = (next: AdminPage) => {
    setPage(next);
    setNavOpen(false);
    const hash = `#${next}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
    // Acting on a section is the moment its badge is most likely stale, so re-poll rather
    // than leaving a count that contradicts the screen the operator is now looking at.
    refreshBadges();
  };

  const toggleRail = () => {
    setRailed(current => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // A locked-down storage partition should cost the preference, not the click.
      }
      return next;
    });
  };

  // The drawer is a mobile affordance; if the viewport grows back into column territory
  // leave it closed so the scrim does not linger over a sidebar that is already visible.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > NAV_DRAWER_MAX_WIDTH) setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [navOpen]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    const checkAdminSession = async () => {
      if (!api.tokens.hasStoredSession()) {
        setChecking(false);
        return;
      }
      const sessionReady = await api.tokens.ensureFreshAccessToken();
      if (!sessionReady) {
        if (active) {
          setAuthed(false);
          setChecking(false);
        }
        return;
      }
      try {
        const user = await api.auth.me();
        if (!active) return;
        if (isAdminUser(user)) {
          setAuthed(true);
          setAdminUser(user);
          return;
        }
        api.tokens.clearTokens();
        setAuthed(false);
      } catch {
        if (!active) return;
        api.tokens.clearTokens();
        setAuthed(false);
      } finally {
        if (active) setChecking(false);
      }
    };
    void checkAdminSession();
    return () => {
      active = false;
    };
  }, []);

  const login = async () => {
    setLoginError('');
    const nextEmail = email.trim();
    const nextPassword = password;
    if (!nextEmail || !nextPassword) {
      setLoginError('Enter admin email/username and password.');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.auth.adminLogin(nextEmail, nextPassword);
      if (!isAdminUser(session.user)) throw new Error('This account does not have admin access.');
      setAdminUser(session.user);
      setAuthed(true);
      await refreshSession();
      if (!window.location.hash) window.history.replaceState(null, '', '#dashboard');
    } catch (err) {
      api.tokens.clearTokens();
      setAuthed(false);
      setLoginError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  };

  const logout = () => {
    api.tokens.clearTokens();
    setAuthed(false);
    setAdminUser(null);
    setEmail('');
    setPassword('');
    window.history.replaceState(null, '', window.location.pathname);
  };

  if (checking) {
    return (
      <AdminGate>
        <div className="admin-gate-card admin-gate-loading" role="status">
          <span className="admin-gate-seal">CSM</span>
          <p>Opening the house desk…</p>
        </div>
      </AdminGate>
    );
  }

  if (!authed) {
    return (
      <AdminGate>
        <form
          className="admin-gate-card"
          onSubmit={event => {
            event.preventDefault();
            void login();
          }}
        >
          <div className="admin-gate-kicker">
            <ShieldCheck size={16} aria-hidden="true" />
            Staff access
          </div>
          <h1>Sign in to the atelier desk</h1>
          <p className="admin-gate-lead">Operations email and password. Catalog, floor stock, and order lifecycle live here.</p>
          {loginError && <div className="admin-gate-error" role="alert">{loginError}</div>}
          <label className="admin-gate-field">
            <span>Email or username</span>
            <div>
              <Mail size={18} aria-hidden="true" />
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@csmsilks.com"
                autoComplete="username"
                autoFocus
              />
            </div>
          </label>
          <label className="admin-gate-field">
            <span>Password</span>
            <div>
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="admin-gate-eye"
                onClick={() => setShowPassword(open => !open)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <button className="admin-gate-submit" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            {submitting ? 'Signing in…' : 'Enter console'}
          </button>
          <a className="admin-gate-storefront" href="/">Back to the storefront</a>
        </form>
      </AdminGate>
    );
  }

  const navGroups = buildNavGroups(badgeCounts);
  const navItems = navGroups.flatMap((group) => group.items);
  const activeGroup = navGroups.find(group => group.items.some(item => item.key === page));
  const activeItem = navItems.find(item => item.key === page);

  return (
    <div className={`admin-shell${railed ? ' is-railed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <div className="admin-nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <aside className="admin-sidebar" id="admin-sidebar">
        <div className="admin-logo">
          <span className="admin-mark">CSM</span>
          <span className="admin-tag">Kanchipuram house desk</span>
          <div className="admin-version"><span className="v-dot" /> Live atelier</div>
        </div>
        <nav className="admin-nav" aria-label="Console sections">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-section">
              <div className="nav-group" title={group.hint}>{group.label}</div>
              <ul className="nav-list">
                {group.items.map(({ key, label, icon: Icon, badge }) => (
                  <li key={key} className={`nav-item ${page === key ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="nav-item-btn"
                      aria-current={page === key ? 'page' : undefined}
                      title={railed ? label : undefined}
                      onClick={() => navigatePage(key)}
                    >
                      <span className="nav-icon-wrap" aria-hidden="true"><Icon className="nav-icon" size={16} /></span>
                      <span className="nav-item-label">{label}</span>
                      {badge && <AdminNavBadge badge={badge} label={label} />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <button
            type="button"
            className="admin-rail-btn"
            onClick={toggleRail}
            aria-pressed={railed}
            title={railed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="nav-item-label">Collapse</span>
          </button>
          <button className="admin-logout-btn" onClick={logout}>
            <LogOut size={16} />
            <span className="nav-item-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-lead">
            <button
              type="button"
              className="admin-nav-toggle"
              onClick={() => setNavOpen(open => !open)}
              aria-expanded={navOpen}
              aria-controls="admin-sidebar"
              aria-label={navOpen ? 'Close console menu' : 'Open console menu'}
            >
              <Menu size={18} />
            </button>
            <div className="admin-topbar-heading">
              <span className="admin-topbar-group">{activeGroup?.label || 'Floor'}</span>
              <h1 className="admin-topbar-title">{activeItem?.label || 'Dashboard'}</h1>
            </div>
          </div>
          <div className="admin-topbar-actions">
            {adminUser && <span className="admin-user-chip">{adminUser.email || adminUser.full_name || 'Admin'}</span>}
            <div className="live-chip"><span className="live-dot2" /> LIVE API</div>
            <button className="admin-soft-btn" onClick={logout}><LogOut size={14} /> Sign out</button>
          </div>
        </header>
        <div className="admin-content">
          {page === 'dashboard' && <AdminDashboard onOpenPage={navigatePage} />}
          {page === 'orders' && <AdminOrders />}
          {page === 'products' && <AdminCatalogManager />}
          {page === 'inventory' && <AdminInventory />}
          {page === 'shipments' && <AdminShipments />}
          {page === 'coupons' && <AdminCoupons />}
          {page === 'returns' && <AdminReturns />}
          {page === 'customers' && <AdminCustomers />}
          {page === 'reviews' && <AdminReviews />}
          {page === 'reports' && <AdminReports />}
          {page === 'audit' && <AdminAuditLogs />}
          {page === 'unsold' && <AdminUnsold />}
        </div>
      </div>
    </div>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  return (
    <div className="admin-gate">
      <section className="admin-gate-story" aria-label="CSM Silks operations atelier">
        <div className="admin-gate-brand">
          <span>CSM</span>
          <em>Silks · since 1987</em>
        </div>
        <div className="admin-gate-copy">
          <p className="admin-gate-eyebrow">Operations atelier</p>
          <h2>Run the house from one silk desk.</h2>
          <p>Catalog truth, live orders, packing, and returns — the same floor rhythm as Kanchipuram, on a quieter screen.</p>
        </div>
        <ul className="admin-gate-points">
          <li>
            <ShoppingBag size={18} />
            <div>
              <strong>Order lifecycle</strong>
              <span>Confirm, pack, ship, and recover RTO without leaving the desk.</span>
            </div>
          </li>
          <li>
            <Boxes size={18} />
            <div>
              <strong>Stock as woven</strong>
              <span>SKU, unsold capital, and live catalog updates in one pulse.</span>
            </div>
          </li>
          <li>
            <ShieldCheck size={18} />
            <div>
              <strong>House audit</strong>
              <span>Staff actions stay attributed. The floor stays accountable.</span>
            </div>
          </li>
        </ul>
      </section>
      <div className="admin-gate-panel">{children}</div>
    </div>
  );
}

function AdminDashboard({ onOpenPage }: { onOpenPage: (page: AdminPage) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [orderRealtimeStatus, setOrderRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const load = useCallback(() => {
    return api.admin.dashboard().then(data => setData(data as DashboardData)).catch(() => setData(null)).finally(() => setLoaded(true));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setOrderRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setNotice(`Live dashboard refresh: ${message.order.order_number} moved to ${ORDER_STATUS_LABEL[message.order.status] || message.order.status}.`);
      void load();
    },
  }), [load]);
  const catalogRealtimeStatus = useCatalogLiveRefresh({
    onUpdate: message => {
      if (!message.type.startsWith('catalog.') && message.type !== 'inventory.variant.updated') return;
      setNotice(message.variant?.sku ? `Live dashboard stock refresh: ${message.variant.sku} changed.` : 'Live dashboard catalog refresh received.');
      void load();
    },
  });
  const k = data?.kpis || {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const kpiCards = [
    {
      label: 'Net revenue today',
      value: formatAdminMoney((k.net_revenue_today || k.revenue_today) as number | string | undefined),
      note: `Gross ${formatAdminMoney(k.gross_revenue_today as number | string | undefined)} · refunds ${formatAdminMoney(k.refunds_today as number | string | undefined)}`,
      tone: 'gold' as const,
      icon: IndianRupee,
    },
    {
      label: 'Net revenue month',
      value: formatAdminMoney((k.net_revenue_month || k.revenue_month) as number | string | undefined),
      note: `Gross ${formatAdminMoney(k.gross_revenue_month as number | string | undefined)} · refunds ${formatAdminMoney(k.refunds_month as number | string | undefined)}`,
      tone: 'ink' as const,
      icon: TrendingUp,
    },
    {
      label: 'Orders today',
      value: formatAdminNumber(k.orders_today as number | string | undefined),
      note: `${formatAdminNumber(k.paid_orders_today as number | string | undefined)} paid · ${formatAdminNumber(k.refunded_orders_today as number | string | undefined)} refunded`,
      tone: 'ruby' as const,
      icon: ShoppingBag,
    },
    {
      label: 'Returns today',
      value: formatAdminNumber(k.returns_today as number | string | undefined),
      note: `${formatAdminNumber(k.total_customers as number | string | undefined)} customers in the house book`,
      tone: 'green' as const,
      icon: RotateCcw,
    },
  ];
  const shortcuts = [
    { key: 'orders' as AdminPage, label: 'Orders', hint: 'Lifecycle & packing', icon: ShoppingBag },
    { key: 'products' as AdminPage, label: 'Catalog', hint: 'Sarees, sets, SKUs', icon: Boxes },
    { key: 'shipments' as AdminPage, label: 'Shipments', hint: 'Labels & AWB', icon: Truck },
    { key: 'unsold' as AdminPage, label: 'Stock alerts', hint: 'Capital sitting still', icon: AlertTriangle },
  ];
  const recent = data?.recent_orders || [];
  return (
    <div className="dash-board">
      {notice && <div className="admin-alert good">{notice}</div>}
      <section className="dash-hero">
        <div>
          <span className="admin-eyebrow">{todayLabel}</span>
          <h2>{greeting}, house desk</h2>
          <p>Revenue, orders, and stock refresh from the live floor — not a nightly snapshot.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${orderRealtimeStatus}`}>{orderRealtimeStatus === 'connected' ? 'Live orders' : orderRealtimeStatus}</span>
          <span className={`ws-chip ${catalogRealtimeStatus}`}>{catalogRealtimeStatus === 'connected' ? 'Live catalog' : catalogRealtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </section>
      <div className="kpi-grid-4">
        {kpiCards.map(({ label, value, note, tone, icon: Icon }) => (
          <article key={label} className={`kpi-card kpi-${tone} ${!loaded ? 'is-loading' : ''}`}>
            <div className="kpi-icon" aria-hidden="true"><Icon size={18} /></div>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{loaded ? value : '—'}</div>
            <div className="kpi-note">{note}</div>
          </article>
        ))}
      </div>
      <div className="dash-shortcuts">
        {shortcuts.map(({ key, label, hint, icon: Icon }) => (
          <button key={key} type="button" className="dash-shortcut" onClick={() => onOpenPage(key)}>
            <Icon size={18} />
            <span>
              <strong>{label}</strong>
              <em>{hint}</em>
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
      <DashboardInsights />
      <div className="chart-card dash-orders">
        <div className="chart-title chart-title-between">
          <span>Recent orders</span>
          <button type="button" className="admin-soft-btn" onClick={() => onOpenPage('orders')}>Open orders</button>
        </div>
        {loaded && recent.length === 0 ? (
          <div className="dash-empty">
            <ShoppingBag size={28} />
            <p>No orders in this pulse yet. New checkouts will appear here live.</p>
          </div>
        ) : (
          <AdminOrderTable orders={recent} />
        )}
      </div>
    </div>
  );
}

function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [orderPageInfo, setOrderPageInfo] = useState<OrderPageInfo>({ total: 0, page: 1, per_page: ADMIN_ORDER_PAGE_SIZE, pages: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const loadOrdersPage = useCallback((page = 1, append = false) => {
    if (append) setLoadingMore(true);
    return api.admin.orders({
      page,
      per_page: ADMIN_ORDER_PAGE_SIZE,
      ...(statusFilter ? { status: statusFilter } : {}),
    }).then(data => {
      setOrderPageInfo({ total: data.total, page: data.page, per_page: data.per_page, pages: data.pages || 0 });
      setOrders(prev => {
        if (!append) return data.items;
        const known = new Set(prev.map(order => order.id));
        return [...prev, ...data.items.filter(order => !known.has(order.id))];
      });
    }).catch(() => {
      if (!append) setOrders([]);
    }).finally(() => {
      if (append) setLoadingMore(false);
    });
  }, [statusFilter]);
  const load = useCallback(() => {
    return loadOrdersPage(1, false);
  }, [loadOrdersPage]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setOrders(prev => {
        const exists = prev.some(order => order.id === message.order?.id);
        if (!exists) return [message.order as Order, ...prev];
        return prev.map(order => order.id === message.order?.id ? message.order as Order : order);
      });
      if (message.event) {
        setNotice(`Live update: ${message.order.order_number} - ${message.event.title}.`);
      }
    },
  }), []);
  const runWorkflow = async (order: Order, payload: WorkflowPayload) => {
    setError('');
    try {
      const updated = await api.admin.workflowOrder(order.id, {
        action: payload.action,
        provider: payload.provider || 'manual',
        location: payload.location || 'CSM Kanchipuram operations',
        note: payload.note || defaultWorkflowNote(payload.action),
      });
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
      setNotice(`${updated.order_number} moved to ${ORDER_STATUS_LABEL[updated.status] || updated.status}. Customer tracking log updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update order workflow');
    }
  };
  const downloadInvoice = async (order: Order) => {
    try {
      const blob = await api.admin.orderInvoice(order.id);
      saveBlob(blob, `invoice-${order.order_number}.html`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download invoice');
    }
  };
  return (
    <div className="admin-stack">
      {(notice || error) && <div className={`admin-alert ${error ? 'bad' : 'good'}`}>{error || notice}</div>}
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Fulfillment control</span>
          <h2>Order lifecycle and customer trace</h2>
          <p>Every action below writes a customer-visible tracking event and an admin audit log.</p>
        </div>
        <div className="admin-head-actions">
          <AdminChoice
            label="Status"
            wrap
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: '', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'packed', label: 'Packed' },
              { value: 'shipped', label: 'Shipped' },
              { value: 'out_for_delivery', label: 'Out for delivery' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'return_initiated', label: 'Returns' },
              { value: 'refunded', label: 'Refunded' },
            ]}
          />
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live WebSocket' : realtimeStatus}</span>
          <button className="admin-primary-btn" onClick={load}><RefreshCw size={14} /> Refresh orders</button>
        </div>
      </div>
      <div className="chart-card">
        <AdminOrderTable orders={orders} onWorkflow={runWorkflow} onInvoice={downloadInvoice} />
        {orderPageInfo.page < (orderPageInfo.pages || 0) && (
          <div className="admin-load-more-row">
            <span>Showing {orders.length} of {orderPageInfo.total} orders</span>
            <button className="admin-soft-btn" onClick={() => void loadOrdersPage(orderPageInfo.page + 1, true)} disabled={loadingMore}>
              <RefreshCw size={14} /> {loadingMore ? 'Loading...' : 'Load more orders'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminOrderTable({ orders, onWorkflow, onInvoice }: { orders: AdminOrderRow[]; onWorkflow?: (order: Order, payload: WorkflowPayload) => void; onInvoice?: (order: Order) => void }) {
  const [forms, setForms] = useState<Record<number, WorkflowPayload>>({});
  const getForm = (order: Order) => forms[order.id] || defaultWorkflowForm(order);
  const updateForm = (order: Order, patch: Partial<WorkflowPayload>) => {
    setForms(prev => {
      const current = prev[order.id] || defaultWorkflowForm(order);
      const next = { ...current, ...patch };
      if (patch.action && !patch.note) next.note = defaultWorkflowNote(patch.action);
      return { ...prev, [order.id]: next };
    });
  };

  if (onWorkflow) {
    return (
      <div className="admin-order-flow-list">
        {orders.map(row => {
          const order = row as Order;
          const form = getForm(order);
          const latest = latestTrackingEvent(order);
          const events = sortTrackingEvents(order.tracking_events || []);
          const progress = lifecycleProgress(order);
          const customer = row.customer || row.shipping_address_snapshot?.full_name || 'Customer';
          const options = workflowActionOptions(order);
          return (
            <div key={row.id} className="admin-order-flow-card">
              <div className="admin-order-flow-main">
                <div className="admin-order-flow-head">
                  <div>
                    <span className="admin-order-number">{row.order_number}</span>
                    <small>{customer} / {row.created_at ? formatDateTime(row.created_at) : '-'}</small>
                  </div>
                  <span className={`status-badge ${adminStatusClass(row.status)}`}>{ORDER_STATUS_LABEL[order.status] || row.status}</span>
                </div>
                <div className="admin-order-meta-grid">
                  <span>Total <b>Rs {Number(row.total || row.total_amount || 0).toLocaleString('en-IN')}</b></span>
                  <span>Courier <b>{order.courier_name || 'Pending'}</b></span>
                  <span>AWB <b>{order.tracking_number || 'Not created'}</b></span>
                </div>
                <div className="admin-mini-lifecycle">
                  {progress.map(stage => <span key={stage.key} className={stage.state}>{stage.label}</span>)}
                </div>
                <div className="admin-order-events">
                  <strong><Clock3 size={14} /> Customer-visible logs</strong>
                  {events.slice(-3).reverse().map(event => (
                    <div key={`${event.id}-${event.happened_at}`} className="admin-order-event-row">
                      <span>{event.title}</span>
                      <small>{[event.location, formatDateTime(event.happened_at)].filter(Boolean).join(' / ')}</small>
                    </div>
                  ))}
                  {!events.length && <div className="admin-order-event-row"><span>No tracking event yet</span><small>Next action will create one.</small></div>}
                  {latest && <em>Latest customer message: {latest.description}</em>}
                </div>
              </div>

              <div className="admin-order-control">
                <label className="admin-field">Next update
                  <select value={options.some(([action]) => action === form.action) ? form.action : options[0]?.[0] || ''} onChange={e => updateForm(order, { action: e.target.value })} disabled={!options.length}>
                    {options.map(([action, label]) => <option key={action} value={action}>{label}</option>)}
                    {!options.length && <option value="">No safe workflow action</option>}
                  </select>
                </label>
                <label className="admin-field">Courier/provider
                  <input value={form.provider} onChange={e => updateForm(order, { provider: e.target.value })} placeholder="manual / Shiprocket / DTDC" />
                </label>
                <label className="admin-field">Location
                  <input value={form.location} onChange={e => updateForm(order, { location: e.target.value })} placeholder="CSM Kanchipuram operations" />
                </label>
                <label className="admin-field">Customer note
                  <textarea rows={3} value={form.note} onChange={e => updateForm(order, { note: e.target.value })} />
                </label>
                <div className="admin-order-control-actions">
                  <button className="admin-primary-btn" onClick={() => void onWorkflow(order, options.some(([action]) => action === form.action) ? form : { ...form, action: options[0]?.[0] || form.action })} disabled={!options.length}><Send size={14} /> Apply update</button>
                  {onInvoice && <button onClick={() => void onInvoice(order)}>Invoice</button>}
                </div>
                <p><MapPin size={13} /> This creates a timeline event on customer tracking immediately after save.</p>
              </div>
            </div>
          );
        })}
        {orders.length === 0 && <div className="admin-empty-row">No orders yet.</div>}
      </div>
    );
  }

  return (
    <table className="admin-table">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td>{o.order_number}</td>
            <td>{o.customer || o.shipping_address_snapshot?.full_name || '-'}</td>
            <td>Rs {Number(o.total || o.total_amount || 0).toLocaleString('en-IN')}</td>
            <td><span className={`status-badge ${adminStatusClass(o.status)}`}>{ORDER_STATUS_LABEL[o.status as Order['status']] || o.status}</span></td>
            <td>{o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN') : '-'}</td>
            <td>
              {onInvoice && <button onClick={() => void onInvoice(o as Order)}>Invoice</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdminInventory() {
  const [items, setItems] = useState<AdminInventoryRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return api.admin.inventory().then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const realtimeStatus = useCatalogLiveRefresh({
    onUpdate: message => {
      if (message.type !== 'inventory.variant.updated' && !message.type.startsWith('catalog.variant')) return;
      setNotice(message.variant?.sku ? `Live stock update received for ${message.variant.sku}.` : 'Live stock update received.');
      void load();
    },
  });

  const adjust = async (row: AdminInventoryRow) => {
    const delta = Number(adjustments[row.variant_id] || 0);
    if (!delta) return;
    setError('');
    try {
      await api.admin.adjustInventory({
        variant_id: row.variant_id,
        quantity_delta: delta,
        note: `Admin stock ${delta > 0 ? 'add' : 'reduce'} from operations UI`,
      });
      setAdjustments(prev => ({ ...prev, [row.variant_id]: '' }));
      setNotice(`${row.sku} stock adjusted by ${delta}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to adjust stock');
    }
  };

  return (
    <div className="admin-stack">
      {(notice || error) && <div className={`admin-alert ${error ? 'bad' : 'good'}`}>{error || notice}</div>}
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Stock control</span>
          <h2>Inventory adjustment</h2>
          <p>Add received stock, reduce damaged stock, and keep low-stock flags visible before customers buy.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live inventory' : realtimeStatus}</span>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Reserved</th><th>Available</th><th>Status</th><th>Adjust</th></tr></thead>
          <tbody>
            {items.map(row => (
              <tr key={row.variant_id}>
                <td>{row.product_name}</td>
                <td>{row.sku}</td>
                <td>{row.stock_qty}</td>
                <td>{row.reserved_qty}</td>
                <td>{row.available_qty}</td>
                <td><span className={`status-badge ${row.low_stock ? 'st-pending' : 'st-delivered'}`}>{row.low_stock ? 'Low stock' : 'Healthy'}</span></td>
                <td>
                  <div className="admin-inline-form">
                    <input
                      type="number"
                      value={adjustments[row.variant_id] || ''}
                      onChange={e => setAdjustments(prev => ({ ...prev, [row.variant_id]: e.target.value }))}
                      placeholder="+10 / -2"
                    />
                    <button onClick={() => void adjust(row)}>Save</button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7}><div className="admin-empty-row">No inventory rows yet. Add products in Catalog first.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminShipments() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<AdminShipment[]>([]);
  const [form, setForm] = useState({ order: '', provider: 'manual', awb_number: '', tracking_url: '', status: 'created' as AdminShipment['status'], event_location: '', event_note: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');

  const load = useCallback(() => {
    return Promise.all([
      api.admin.orders({ per_page: 100 }).then(data => data.items),
      api.admin.shipments(),
    ]).then(([orderData, shipmentData]) => {
      setOrders(orderData);
      setShipments(shipmentData);
      setForm(prev => prev.order || !orderData[0] ? prev : { ...prev, order: String(orderData[0].id) });
    }).catch(() => {
      setOrders([]);
      setShipments([]);
    });
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setNotice(`Live shipment refresh: ${message.order.order_number} tracking changed.`);
      void load();
    },
  }), [load]);

  const saveShipment = async () => {
    if (!form.order) return;
    setError('');
    try {
      const shipment = await api.admin.createShipment({
        order: Number(form.order),
        provider: form.provider,
        awb_number: form.awb_number,
        tracking_url: form.tracking_url,
        status: form.status,
        event_location: form.event_location,
        event_note: form.event_note,
      });
      setNotice(`${shipment.order_number} shipment saved.`);
      setForm(prev => ({ ...prev, event_location: '', event_note: '' }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save shipment');
    }
  };

  const downloadShipmentFile = async (shipment: AdminShipment, kind: 'label' | 'manifest') => {
    try {
      const blob = kind === 'label' ? await api.admin.shipmentLabel(shipment.id) : await api.admin.shipmentManifest(shipment.id);
      saveBlob(blob, `${kind}-${shipment.order_number}.txt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to download ${kind}`);
    }
  };

  return (
    <div className="admin-create-grid compact">
      <div className="admin-form-card">
        <div className="chart-title chart-title-between">
          <span><Truck size={18} /> Add shipment / tracking</span>
          <small className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live shipments' : realtimeStatus}</small>
        </div>
        <label className="admin-field wide">Order
          <select value={form.order} onChange={e => setForm({ ...form, order: e.target.value })}>
            {orders.map(order => <option key={order.id} value={order.id}>{order.order_number} - Rs {Number(order.total_amount).toLocaleString('en-IN')}</option>)}
          </select>
        </label>
        <div className="admin-form-grid">
          <label className="admin-field">Courier<input value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} placeholder="Shiprocket / DTDC" /></label>
          <label className="admin-field">AWB / Tracking<input value={form.awb_number} onChange={e => setForm({ ...form, awb_number: e.target.value })} /></label>
          <label className="admin-field wide">Tracking URL<input value={form.tracking_url} onChange={e => setForm({ ...form, tracking_url: e.target.value })} placeholder="https://..." /></label>
          <label className="admin-field">Status
            <AdminChoice
              wrap
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              options={[
                { value: 'created', label: 'Created' },
                { value: 'picked_up', label: 'Picked up' },
                { value: 'in_transit', label: 'In transit' },
                { value: 'out_for_delivery', label: 'Out for delivery' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'failed', label: 'Failed' },
                { value: 'rto_initiated', label: 'RTO started' },
                { value: 'rto_delivered', label: 'RTO in' },
              ]}
            />
          </label>
          <label className="admin-field">Current location<input value={form.event_location} onChange={e => setForm({ ...form, event_location: e.target.value })} placeholder="Kanchipuram hub" /></label>
          <label className="admin-field wide">Customer update note<input value={form.event_note} onChange={e => setForm({ ...form, event_note: e.target.value })} placeholder="Package handed to courier / reached Chennai hub" /></label>
        </div>
        {notice && <div className="admin-alert good">{notice}</div>}
        {error && <div className="admin-alert bad">{error}</div>}
        <button className="admin-primary-btn admin-submit" onClick={() => void saveShipment()}>Save shipment</button>
      </div>
      <div className="admin-form-card">
        <div className="chart-title">Current shipments</div>
        <div className="admin-collection-list">
          {shipments.map(shipment => (
            <div key={shipment.id} className="admin-collection-row">
              <div>
                <strong>{shipment.order_number}</strong>
                <span>{shipment.provider} / {shipment.awb_number || 'No AWB'} / {shipment.status}</span>
                {shipment.events?.length ? (
                  <span className="admin-muted-line">{shipment.events[shipment.events.length - 1].title} - {shipment.events[shipment.events.length - 1].location || 'location pending'}</span>
                ) : null}
              </div>
              <span className={`status-badge ${shipment.status === 'delivered' ? 'st-delivered' : 'st-shipped'}`}>{shipment.status}</span>
              <div className="admin-row-actions">
                <button onClick={() => void downloadShipmentFile(shipment, 'label')}>Label</button>
                <button onClick={() => void downloadShipmentFile(shipment, 'manifest')}>Manifest</button>
              </div>
            </div>
          ))}
          {shipments.length === 0 && <div className="admin-empty-row">No shipments yet. Create one when an order is ready for courier handover.</div>}
        </div>
      </div>
    </div>
  );
}

type CouponForm = {
  code: string;
  description: string;
  discount_type: AdminCoupon['discount_type'];
  value: string;
  min_order_value: string;
  usage_limit: string;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
};

const emptyCouponForm: CouponForm = {
  code: '',
  description: '',
  discount_type: 'percent',
  value: '10',
  min_order_value: '0',
  usage_limit: '',
  starts_at: '',
  expires_at: '',
  is_active: true,
};

function toDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function couponToForm(coupon: AdminCoupon): CouponForm {
  return {
    code: coupon.code,
    description: coupon.description || '',
    discount_type: coupon.discount_type,
    value: String(coupon.value || ''),
    min_order_value: String(coupon.min_order_value || '0'),
    usage_limit: coupon.usage_limit == null ? '' : String(coupon.usage_limit),
    starts_at: toDateTimeLocal(coupon.starts_at),
    expires_at: toDateTimeLocal(coupon.expires_at),
    is_active: coupon.is_active,
  };
}

function formToCouponPayload(form: CouponForm): Partial<AdminCoupon> {
  return {
    code: form.code.trim().toUpperCase(),
    description: form.description.trim(),
    discount_type: form.discount_type,
    value: form.value || '0',
    min_order_value: form.min_order_value || '0',
    usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
    starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
    expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    is_active: form.is_active,
  };
}

function AdminCoupons() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [form, setForm] = useState<CouponForm>(emptyCouponForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    return api.admin.coupons().then(setCoupons).catch(() => setCoupons([]));
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyCouponForm);
  };

  const saveCoupon = async () => {
    if (!form.code.trim()) {
      setNotice('Coupon code is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = formToCouponPayload(form);
      const saved = editingId
        ? await api.admin.updateCoupon(editingId, payload)
        : await api.admin.createCoupon(payload);
      setNotice(`${saved.code} ${editingId ? 'updated' : 'created'} successfully.`);
      resetForm();
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to save coupon.');
    } finally {
      setSaving(false);
    }
  };

  const editCoupon = (coupon: AdminCoupon) => {
    setEditingId(coupon.id);
    setForm(couponToForm(coupon));
    setNotice('');
  };

  const toggleCoupon = async (coupon: AdminCoupon) => {
    try {
      const updated = await api.admin.updateCoupon(coupon.id, { is_active: !coupon.is_active });
      setCoupons(prev => prev.map(item => item.id === updated.id ? updated : item));
      setNotice(`${updated.code} is now ${updated.is_active ? 'active' : 'paused'}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Unable to update coupon.');
    }
  };

  return (
    <div className="admin-create-grid compact">
      <div className="admin-form-card">
        <div className="chart-title"><BadgePercent size={18} /> {editingId ? 'Edit coupon' : 'Create coupon'}</div>
        <div className="admin-form-grid">
          <label className="admin-field">Code
            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="LAUNCH20" />
          </label>
          <label className="admin-field">Discount type
            <AdminChoice
              value={form.discount_type}
              onChange={(value) => setForm({ ...form, discount_type: value })}
              options={[
                { value: 'percent', label: 'Percentage' },
                { value: 'flat', label: 'Flat amount' },
              ]}
            />
          </label>
          <label className="admin-field">Value
            <input type="number" min="0" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="20" />
          </label>
          <label className="admin-field">Minimum order
            <input type="number" min="0" value={form.min_order_value} onChange={e => setForm({ ...form, min_order_value: e.target.value })} placeholder="1000" />
          </label>
          <label className="admin-field">Usage limit
            <input type="number" min="0" value={form.usage_limit} onChange={e => setForm({ ...form, usage_limit: e.target.value })} placeholder="Blank = unlimited" />
          </label>
          <label className="admin-field">Starts at
            <input type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
          </label>
          <label className="admin-field">Expires at
            <input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
          </label>
          <label className="admin-field coupon-active-field">
            <span>Active coupon</span>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
          </label>
          <label className="admin-field wide">Description
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Launch offer for orders above Rs 1000" />
          </label>
        </div>
        {notice && <div className={`admin-alert ${notice.includes('Unable') || notice.includes('required') ? 'bad' : 'good'}`}>{notice}</div>}
        <div className="admin-row-actions coupon-form-actions">
          <button className="admin-primary-btn" onClick={() => void saveCoupon()} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update coupon' : 'Create coupon'}</button>
          {editingId && <button onClick={resetForm}>Cancel edit</button>}
        </div>
      </div>

      <div className="admin-form-card">
        <div className="chart-title">Coupon library</div>
        <div className="admin-collection-list">
          {coupons.map(coupon => (
            <div key={coupon.id} className="admin-collection-row coupon-row">
              <div>
                <strong>{coupon.code}</strong>
                <span>
                  {coupon.discount_type === 'percent' ? `${Number(coupon.value).toLocaleString('en-IN')}% off` : `Rs ${Number(coupon.value).toLocaleString('en-IN')} off`}
                  {' '}above Rs {Number(coupon.min_order_value).toLocaleString('en-IN')}
                </span>
                <span className="admin-muted-line">
                  Used {coupon.used_count}{coupon.usage_limit ? ` / ${coupon.usage_limit}` : ''} times. {coupon.description || 'No description'}
                </span>
              </div>
              <span className={`status-badge ${coupon.is_active ? 'st-delivered' : 'st-pending'}`}>{coupon.is_active ? 'Active' : 'Paused'}</span>
              <div className="admin-row-actions">
                <button onClick={() => editCoupon(coupon)}>Edit</button>
                <button onClick={() => void toggleCoupon(coupon)}>{coupon.is_active ? 'Pause' : 'Activate'}</button>
              </div>
            </div>
          ))}
          {coupons.length === 0 && <div className="admin-empty-row">No coupons yet. Create one to show discounts in checkout.</div>}
        </div>
      </div>
    </div>
  );
}

const returnStatusOptions: Record<ReturnRequest['status'], Array<[ReturnRequest['status'], string]>> = {
  requested: [['requested', 'Requested'], ['approved', 'Approve'], ['rejected', 'Reject']],
  approved: [['approved', 'Approved'], ['picked_up', 'Mark picked up'], ['rejected', 'Reject']],
  picked_up: [['picked_up', 'Picked up'], ['refunded', 'Refund']],
  refunded: [['refunded', 'Refunded']],
  rejected: [['rejected', 'Rejected']],
};

function returnIsTerminal(status: ReturnRequest['status']) {
  return status === 'refunded' || status === 'rejected';
}

function AdminReturns() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');

  const load = useCallback(() => {
    return api.admin.returns().then(setReturns).catch(() => setReturns([]));
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      if (message.order.status !== 'return_initiated' && message.order.status !== 'returned' && message.order.status !== 'refunded') return;
      setNotice(`Live return refresh: ${message.order.order_number} is ${ORDER_STATUS_LABEL[message.order.status] || message.order.status}.`);
      void load();
    },
  }), [load]);

  const updateReturn = async (ret: ReturnRequest, status: ReturnRequest['status']) => {
    setError('');
    try {
      const updated = await api.admin.updateReturn(ret.id, { status });
      setReturns(prev => prev.map(item => item.id === updated.id ? updated : item));
      setNotice(`${updated.order_number} return marked ${updated.status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update return');
    }
  };

  return (
    <div className="admin-stack">
      {(notice || error) && <div className={`admin-alert ${error ? 'bad' : 'good'}`}>{error || notice}</div>}
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Return operations</span>
          <h2>Return requests</h2>
          <p>Customer return requests and refund status changes update this queue through order lifecycle events.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live returns' : realtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Return</th><th>Customer</th><th>Reason</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>
            {returns.map(ret => (
              <tr key={ret.id}>
                <td>{ret.order_number}</td>
                <td>{ret.customer}</td>
                <td>{ret.reason}<span className="admin-muted-line">{ret.details}</span></td>
                <td><span className={`status-badge ${ret.status === 'refunded' ? 'st-delivered' : 'st-processing'}`}>{ret.status}</span></td>
                <td>{new Date(ret.created_at).toLocaleDateString('en-IN')}</td>
                <td>
                  <select value={ret.status} disabled={returnIsTerminal(ret.status)} onChange={e => void updateReturn(ret, e.target.value as ReturnRequest['status'])}>
                    {returnStatusOptions[ret.status].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {returns.length === 0 && (
              <tr><td colSpan={6}><div className="admin-empty-row">No return requests right now.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminCustomers() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    return api.admin.customers().then(data => setCustomers(data as CustomerRow[])).catch(() => setCustomers([]));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setNotice(`Customer spend refreshed from ${message.order.order_number}.`);
      void load();
    },
  }), [load]);
  return (
    <div className="admin-stack">
      {notice && <div className="admin-alert good">{notice}</div>}
      <div className="admin-panel-head compact">
        <div>
          <span className="admin-eyebrow">Customer ledger</span>
          <h2>Customer spend and tiers</h2>
          <p>Order lifecycle updates refresh customer order counts and spend totals.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live customers' : realtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="chart-card">
        <table className="admin-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Spent</th><th>Tier</th></tr></thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}><td>{c.name}</td><td>{c.phone || c.email}</td><td>{c.orders}</td><td>Rs {Number(c.spent || 0).toLocaleString('en-IN')}</td><td>{c.tier}</td></tr>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={5}><div className="admin-empty-row">No customers yet. They appear after the first order.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminReports() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    return api.admin.reports().then(data => setReport(data as ReportData)).catch(() => setReport(null));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setNotice(`Reports refreshed from ${message.order.order_number}.`);
      void load();
    },
  }), [load]);
  const reportCards = [
    ['Net Revenue', formatAdminMoney((report?.net_revenue || report?.total_revenue) as number | string | undefined), `Gross ${formatAdminMoney(report?.gross_revenue)} minus refunds`],
    ['Gross Revenue', formatAdminMoney(report?.gross_revenue), `${formatAdminNumber(report?.paid_orders)} paid orders`],
    ['Refunds', formatAdminMoney(report?.refunds), `${formatAdminNumber(report?.refunded_orders)} fully refunded / ${formatAdminNumber(report?.partially_refunded_orders)} partial`],
    ['Return Rate', `${formatAdminNumber(report?.return_rate)}%`, `${formatAdminNumber(report?.return_orders)} refunded returns`],
    ['Taxable Sales', formatAdminMoney(report?.taxable_sales), 'Paid order subtotal only'],
    ['GST Collected', formatAdminMoney(report?.gst_total), `CGST ${formatAdminMoney(report?.cgst)} / SGST ${formatAdminMoney(report?.sgst)}`],
  ];
  return (
    <div className="admin-stack">
      {notice && <div className="admin-alert good">{notice}</div>}
      <div className="admin-panel-head compact">
        <div>
          <span className="admin-eyebrow">Financial pulse</span>
          <h2>Revenue and GST reports</h2>
          <p>Paid orders, refunds, returns, and GST totals refresh from live order events.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live reports' : realtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="chart-row-2" style={{ marginBottom: 0 }}>
        {reportCards.map(([label, value, note]) => (
          <div key={label} className="chart-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-note">{note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAuditLogs() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [orderRealtimeStatus, setOrderRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const load = useCallback(() => {
    return api.admin.auditLogs({ action: actionFilter, q: debouncedQuery.trim() }).then(setLogs).catch(() => setLogs([]));
  }, [actionFilter, debouncedQuery]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => connectOrderRealtime('/ws/orders/', {
    onStatus: setOrderRealtimeStatus,
    onMessage: message => {
      if (message.type !== 'order.update' || !message.order) return;
      setNotice(`Audit refreshed from order event ${message.order.order_number}.`);
      void load();
    },
  }), [load]);
  const catalogRealtimeStatus = useCatalogLiveRefresh({
    onUpdate: message => {
      if (!message.type.startsWith('catalog.') && message.type !== 'inventory.variant.updated') return;
      setNotice(message.variant?.sku ? `Audit refreshed from stock event ${message.variant.sku}.` : 'Audit refreshed from catalog event.');
      void load();
    },
  });
  return (
    <div className="admin-stack">
      {notice && <div className="admin-alert good">{notice}</div>}
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Traceability</span>
          <h2>Admin audit trail</h2>
          <p>Operational changes from order workflow, stock adjustments, returns, shipment edits, and courier webhooks.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${orderRealtimeStatus}`}>{orderRealtimeStatus === 'connected' ? 'Live orders' : orderRealtimeStatus}</span>
          <span className={`ws-chip ${catalogRealtimeStatus}`}>{catalogRealtimeStatus === 'connected' ? 'Live catalog' : catalogRealtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="admin-table-toolbar audit-toolbar">
        <label className="admin-field audit-filter">Action
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            <option value="payment.refund">Payment refunds</option>
            <option value="payment.refund_rejected">Rejected refunds</option>
            <option value="order.workflow.confirm">Order confirmations</option>
            <option value="order.workflow.pack">Order packing</option>
            <option value="order.create_label">Label creation</option>
            <option value="shipping.webhook">Courier webhooks</option>
            <option value="return.update">Return updates</option>
          </select>
        </label>
        <label className="admin-field audit-filter wide">Search audit text
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Order number, entity id, action, or summary" />
        </label>
        <span>{logs.length} matching log{logs.length === 1 ? '' : 's'}</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString('en-IN')}</td>
                <td>{log.user_name}<span className="admin-muted-line">{log.user_email || 'system event'}</span></td>
                <td><span className="status-badge st-shipped">{log.action}</span></td>
                <td>{log.entity_type}<span className="admin-muted-line">#{log.entity_id || '-'}</span></td>
                <td>{log.summary}</td>
                <td>{log.ip_address || '-'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6}><div className="admin-empty-row">No audit logs match the current filters.</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminReviews() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [publishedFilter, setPublishedFilter] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    return api.admin.reviews({
      ...(publishedFilter ? { published: publishedFilter } : {}),
      ...(query.trim() ? { q: query.trim() } : {}),
    }).then(setReviews).catch(() => setReviews([]));
  }, [publishedFilter, query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const togglePublished = async (review: AdminReview) => {
    setError('');
    try {
      const updated = await api.admin.updateReview(review.id, { is_published: !review.is_published });
      setReviews(prev => prev.map(item => item.id === updated.id ? updated : item));
      setNotice(`Review for ${updated.product_name} is now ${updated.is_published ? 'published' : 'hidden'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update review');
    }
  };

  return (
    <div className="admin-stack">
      {(notice || error) && <div className={`admin-alert ${error ? 'bad' : 'good'}`}>{error || notice}</div>}
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Reputation control</span>
          <h2>Product review moderation</h2>
          <p>Publish or hide customer reviews. Hidden reviews are removed from product pages and ratings.</p>
        </div>
        <div className="admin-head-actions">
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="admin-table-toolbar">
        <AdminChoice
          label="Visibility"
          value={publishedFilter}
          onChange={setPublishedFilter}
          options={[
            { value: '', label: 'All' },
            { value: 'true', label: 'Published' },
            { value: 'false', label: 'Hidden' },
          ]}
        />
        <label className="admin-search">
          <Search size={16} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search product or review text" />
        </label>
        <span>{reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Product</th><th>Customer</th><th>Rating</th><th>Review</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {reviews.map(review => (
              <tr key={review.id}>
                <td><strong>{review.product_name}</strong><span className="admin-muted-line">/{review.product_slug}</span></td>
                <td>{review.customer}<span className="admin-muted-line">{review.customer_email || ''}</span></td>
                <td>{'★'.repeat(review.rating)}{review.is_verified_purchase ? ' ✓' : ''}</td>
                <td><strong>{review.title || 'Untitled'}</strong><span className="admin-muted-line">{review.body}</span></td>
                <td><span className={`status-badge ${review.is_published ? 'st-delivered' : 'st-pending'}`}>{review.is_published ? 'Published' : 'Hidden'}</span></td>
                <td><button onClick={() => void togglePublished(review)}>{review.is_published ? 'Hide' : 'Publish'}</button></td>
              </tr>
            ))}
            {reviews.length === 0 && (
              <tr><td colSpan={6}><div className="admin-empty-row">No reviews match the current filters.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminUnsold() {
  const [data, setData] = useState<UnsoldData | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    return api.admin.unsold().then(data => setData(data as unknown as UnsoldData)).catch(() => setData(null));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const realtimeStatus = useCatalogLiveRefresh({
    onUpdate: message => {
      if (!message.type.startsWith('catalog.') && message.type !== 'inventory.variant.updated') return;
      setNotice(message.variant?.sku ? `Stock alerts refreshed from ${message.variant.sku}.` : 'Stock alerts refreshed from live catalog.');
      void load();
    },
  });
  return (
    <div className="admin-stack">
      {notice && <div className="admin-alert good">{notice}</div>}
      <div className="admin-panel-head compact">
        <div>
          <span className="admin-eyebrow">Inventory risk</span>
          <h2>{data?.count || 0} unsold stock alerts</h2>
          <p>Inventory and catalog changes refresh this risk view immediately.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live stock alerts' : realtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="chart-card">
        <table className="admin-table">
          <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Days</th><th>Capital</th><th>Severity</th></tr></thead>
          <tbody>
            {(data?.items || []).map((u) => (
              <tr key={u.id}><td>{u.product_name}</td><td>{u.sku}</td><td>{u.stock_qty}</td><td>{u.days_unsold}</td><td>Rs {Number(u.capital_blocked).toLocaleString('en-IN')}</td><td>{u.severity}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
