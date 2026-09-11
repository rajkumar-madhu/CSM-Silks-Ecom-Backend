import type {
  Address,
  AdminAuditLog,
  AdminCoupon,
  AdminOffer,
  AdminReview,
  AdminProductQuickCreatePayload,
  AdminInsights,
  AdminInventoryRow,
  AdminShipment,
  CartResponse,
  CatalogCategory,
  CatalogCollection,
  CatalogFacets,
  CatalogOccasion,
  DeliveryCheck,
  AppNotification,
  LoyaltyReward,
  OffersResponse,
  Order,
  PaginatedResponse,
  Product,
  ProductReview,
  ProductVariant,
  ReturnRequest,
  User,
  CartQuote,
  CartQuoteRequest,
} from '@/types';

const API_BASE = '/api';
const ACCESS_KEY = 'csm_access_token';
const REFRESH_KEY = 'csm_refresh_token';
const API_TARGET = import.meta.env.VITE_API_TARGET || API_BASE;

function getApiOrigin() {
  if (typeof window === 'undefined') return '';
  if (API_TARGET.startsWith('http://') || API_TARGET.startsWith('https://')) {
    return new URL(API_TARGET).origin;
  }
  return window.location.origin;
}

export function resolveAssetUrl(url?: string | null) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (
    url.startsWith('#')
    || url.startsWith('rgb(')
    || url.startsWith('rgba(')
    || url.startsWith('hsl(')
    || url.startsWith('hsla(')
    || url.startsWith('linear-gradient(')
    || url.startsWith('radial-gradient(')
  ) {
    return url;
  }
  if (url.startsWith('/media/')) {
    return new URL(url, getApiOrigin()).toString();
  }
  if (url.startsWith('/')) {
    return url;
  }
  return new URL(`/${url}`, getApiOrigin()).toString();
}

export function isImageAssetUrl(url?: string | null) {
  if (!url) return false;
  return url.startsWith('http')
    || url.startsWith('/')
    || url.startsWith('data:')
    || url.startsWith('blob:');
}

type JsonMap = Record<string, unknown>;
type RazorpayOrderResponse = { razorpay_order_id: string; amount: number; currency: string; order_id: number; key?: string };
type PaymentVerifyPayload = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type AdminDashboardResponse = { kpis: JsonMap; recent_orders: JsonMap[] };
type UnsoldResponse = { count: number; total_capital_blocked: number | string; items: JsonMap[] };
type WishlistApiItem = { id: number; product: Product; created_at: string };
type NotificationListResponse = PaginatedResponse<AppNotification> & { unread_count: number };
type OTPDeliveryResponse = {
  message: string;
  sms_sent?: boolean;
  email_sent?: boolean;
  email_masked?: string;
  delivery_channels?: string[];
  dev_otp?: string;
};
type CustomerSignupProfile = {
  full_name?: string;
  email?: string;
  wa_opted_in?: boolean;
  push_opted_in?: boolean;
};
type QueryParams = Record<string, string | number | boolean | undefined>;

export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access?: string, refresh?: string) {
  if (access) localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

type RefreshSessionResponse = { access_token?: string; refresh_token?: string; user?: User };

function decodeJwtPayload(token: string): { exp?: number } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(window.atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
}

function isJwtExpired(token: string | null | undefined, skewSeconds = 30) {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

function hasStoredSession() {
  return Boolean(getAccessToken() || getRefreshToken());
}

async function refreshSession(): Promise<RefreshSessionResponse | null> {
  const refresh = getRefreshToken();
  if (!refresh || isJwtExpired(refresh)) {
    clearTokens();
    return null;
  }
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = await res.json() as RefreshSessionResponse;
  setTokens(data.access_token, data.refresh_token);
  return data;
}

async function refreshAccessToken() {
  const data = await refreshSession();
  return Boolean(data?.access_token);
}

async function ensureFreshAccessToken() {
  const access = getAccessToken();
  if (access && !isJwtExpired(access)) return true;
  const refresh = getRefreshToken();
  if (!refresh || isJwtExpired(refresh)) {
    clearTokens();
    return false;
  }
  return refreshAccessToken();
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    price: Number(product.price || 0),
    mrp: Number(product.mrp || 0),
    images: (product.images || []).map(resolveAssetUrl).filter(Boolean),
    image_records: (product.image_records || []).map(record => ({
      ...record,
      image_url: resolveAssetUrl(record.image_url),
    })),
    variants: (product.variants || []).map(variant => ({
      ...variant,
      price: Number(variant.price || 0),
      mrp: Number(variant.mrp || 0),
      available_qty: Number(variant.available_qty ?? 0),
    })),
    colors: product.colors || product.colours || ['#C4923A'],
    hook: product.hook || '',
    badge: product.badge || 'pb-new',
    'badge-text': product['badge-text'] || 'New',
    emoji: product.emoji || 'CSM',
    bg: product.bg || 'linear-gradient(145deg,#1A1208,#8B1A1A,#C4923A)',
  };
}

function formatApiError(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatApiError).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('detail' in record) return formatApiError(record.detail);
    if ('message' in record) return formatApiError(record.message);
    return Object.entries(record)
      .map(([key, nested]) => `${key}: ${formatApiError(nested)}`)
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfter: number) {
    super(`Too many requests. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before trying again.`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfter;
  }
}

export { RateLimitError };

async function request<T>(endpoint: string, options?: RequestInit, retryOnUnauthorized = true): Promise<T> {
  let token = getAccessToken();
  if (token && !endpoint.startsWith('/auth/refresh')) {
    const ready = await ensureFreshAccessToken();
    token = ready ? getAccessToken() : null;
  }
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (res.status === 401 && retryOnUnauthorized && !endpoint.startsWith('/auth/refresh')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(endpoint, options, false);
  }
  if (res.status === 429) {
    const retryAfter = Math.ceil(Number(res.headers.get('Retry-After') || '30'));
    throw new RateLimitError(isNaN(retryAfter) ? 30 : retryAfter);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(err.detail || err.message || err) || `API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function download(endpoint: string, retryOnUnauthorized = true): Promise<Blob> {
  let token = getAccessToken();
  if (token) {
    const ready = await ensureFreshAccessToken();
    token = ready ? getAccessToken() : null;
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401 && retryOnUnauthorized) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return download(endpoint, false);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(err.detail || err.message || err) || `API error: ${res.status}`);
  }
  return res.blob();
}

function queryString(params?: QueryParams) {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== '');
  return entries.length ? '?' + new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString() : '';
}

export const api = {
  tokens: { getAccessToken, getRefreshToken, setTokens, clearTokens, refreshAccessToken, ensureFreshAccessToken, hasStoredSession },

  offers: {
    list: () => request<OffersResponse>('/offers'),
  },

  products: {
    list: async (params?: Record<string, string | number | boolean | undefined>) => {
      const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== '');
      const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
      const data = await request<PaginatedResponse<Product>>(`/products${qs}`);
      return { ...data, items: data.items.map(normalizeProduct) };
    },
    search: async (params?: Record<string, string | number | boolean | undefined>) => {
      const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== '');
      const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
      const data = await request<PaginatedResponse<Product>>(`/search${qs}`);
      return { ...data, items: data.items.map(normalizeProduct) };
    },
    get: async (slug: string) => normalizeProduct(await request<Product>(`/products/${slug}`)),
    facets: (params?: Record<string, string | number | boolean | undefined>) => {
      const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== '');
      const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
      return request<CatalogFacets>(`/catalog/facets${qs}`);
    },
    categories: () => request<CatalogCategory[]>('/categories'),
    collections: () => request<CatalogCollection[]>('/collections'),
    occasions: (params?: Record<string, string | number | undefined>) => {
      const query = new URLSearchParams();
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== '') query.set(key, String(value));
      });
      const suffix = query.toString();
      return request<CatalogOccasion[]>(`/occasions${suffix ? `?${suffix}` : ''}`);
    },
    delivery: (slug: string, pin_code: string) =>
      request<DeliveryCheck>(`/products/${slug}/delivery?pin_code=${encodeURIComponent(pin_code)}`),
    stockAlert: (slug: string, data: { phone: string; email?: string; variant_id?: number }) =>
      request<{ ok: boolean; created: boolean; message: string; sku: string }>(`/products/${slug}/stock-alert`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    reviews: {
      list: (slug: string) => request<ProductReview[]>(`/products/${slug}/reviews`),
      create: (slug: string, data: { rating: number; title: string; body: string }) =>
        request<ProductReview>(`/products/${slug}/reviews`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
    },
  },

  auth: {
    config: () => request<{
      google_oauth_enabled: boolean;
      google_client_id: string;
      google_redirect_enabled: boolean;
      google_redirect_uri: string;
      google_redirect_uris: string[];
      otp_dev_fallback_enabled: boolean;
      otp_delivery_configured: boolean;
    }>('/auth/config'),
    googleLogin: async (id_token: string, nonce?: string) => {
      const data = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ id_token, ...(nonce ? { nonce } : {}) }),
      });
      setTokens(data.access_token, data.refresh_token);
      return data;
    },
    googleExchange: async (code: string, redirect_uri: string) => {
      const data = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/google/exchange', {
        method: 'POST',
        body: JSON.stringify({ code, redirect_uri }),
      });
      setTokens(data.access_token, data.refresh_token);
      return data;
    },
    sendOtp: (phone: string, email?: string) => request<OTPDeliveryResponse>('/auth/otp/send', {
      method: 'POST',
      body: JSON.stringify({ phone, ...(email ? { email } : {}) }),
    }),
    verifyOtp: async (phone: string, otp: string, profile?: CustomerSignupProfile) => {
      const data = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, otp, ...(profile || {}) }),
      });
      setTokens(data.access_token, data.refresh_token);
      return data;
    },
    adminLogin: async (email: string, password: string) => {
      const data = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setTokens(data.access_token, data.refresh_token);
      return data;
    },
    me: () => request<User>('/auth/me'),
    updateMe: (data: Partial<User>) => request<User>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    refresh: async () => {
      const data = await refreshSession();
      if (!data?.access_token || !data.refresh_token || !data.user) throw new Error('Session refresh failed');
      return data as { access_token: string; refresh_token: string; user: User };
    },
    logout: () => {
      clearTokens();
      return Promise.resolve();
    },
  },

  cart: {
    get: () => request<CartResponse>('/cart'),
    add: (variant_id: number, quantity: number) =>
      request<CartResponse>('/cart', {
        method: 'POST',
        body: JSON.stringify({ variant_id, quantity }),
      }),
    update: (itemId: number, quantity: number) =>
      request<CartResponse>(`/cart/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      }),
    remove: (itemId: number) =>
      request<CartResponse>(`/cart/items/${itemId}`, { method: 'DELETE' }),
    clear: () => request<void>('/cart', { method: 'DELETE' }),
    coupon: (coupon_code: string) =>
      request<CartResponse>('/cart/coupon', {
        method: 'POST',
        body: JSON.stringify({ coupon_code }),
      }),
    summary: () => request<CartResponse>('/checkout/summary'),
    // Authoritative checkout totals. Do not recompute GST/shipping/coupon in the SPA —
    // the server prices finishing into the coupon base and the two drift otherwise.
    quote: (payload: CartQuoteRequest) =>
      request<CartQuote>('/cart/quote', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  orders: {
    list: (params?: QueryParams) => {
      const qs = queryString(params);
      return request<PaginatedResponse<Order>>(`/orders${qs}`);
    },
    get: (orderId: string | number) => request<Order>(`/orders/${orderId}`),
    track: (identifier: string, phone: string) =>
      request<Order>(`/orders/track?identifier=${encodeURIComponent(identifier)}&phone=${encodeURIComponent(phone)}`),
    create: (data: {
      address_id: number;
      coupon_code?: string;
      loyalty_points_to_use?: number;
      payment_method?: 'cod' | 'razorpay';
      occasion_note?: string;
      finishing?: Array<{
        cart_item_id: number;
        blouse_stitching?: boolean;
        blouse_size?: string;
        fall_pico?: boolean;
      }>;
    }) =>
      request<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    cancel: (orderId: string | number) =>
      request<Order>(`/orders/${orderId}/cancel`, { method: 'POST' }),
    invoice: (orderId: string | number) => download(`/orders/${orderId}/invoice`),
  },

  returns: {
    list: () => request<JsonMap[]>('/returns'),
    create: (data: { order_id: number; reason: string; details?: string }) =>
      request<JsonMap>('/returns', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  payments: {
    createRazorpayOrder: (orderId: number) =>
      request<RazorpayOrderResponse>('/payments/razorpay/order', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId }),
      }),
    verify: (data: PaymentVerifyPayload) =>
      request<{ message: string; order_number: string; order_id: number }>('/payments/razorpay/verify', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  ai: {
    tryon: (data: JsonMap) =>
      request<JsonMap>('/ai/tryon', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    voiceSearch: (data: JsonMap) =>
      request<JsonMap>('/ai/voice-search', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    recommend: () => request<{ items: Product[] }>('/ai/recommend'),
  },

  admin: {
    dashboard: () => request<AdminDashboardResponse>('/admin/dashboard'),
    insights: (days?: number) => request<AdminInsights>(`/admin/insights${days ? `?days=${days}` : ''}`),
    products: (params?: QueryParams) => {
      const qs = queryString(params);
      return request<PaginatedResponse<Product>>(`/admin/products${qs}`).then(data => ({
        ...data,
        items: data.items.map(normalizeProduct),
      }));
    },
    updateProduct: async (productId: number, data: JsonMap) =>
      normalizeProduct(await request<Product>(`/admin/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })),
    getProduct: async (productId: number) =>
      normalizeProduct(await request<Product>(`/admin/products/${productId}`)),
    deleteProduct: (productId: number) =>
      request<void>(`/admin/products/${productId}`, { method: 'DELETE' }),
    variants: () => request<ProductVariant[]>('/admin/variants'),
    updateVariant: (variantId: number, data: JsonMap) =>
      request<ProductVariant>(`/admin/variants/${variantId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    createCategory: (data: Partial<CatalogCategory>) =>
      request<CatalogCategory>('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    reviews: (params?: { published?: string; q?: string; limit?: number }) => {
      const qs = queryString(params);
      return request<AdminReview[]>(`/admin/reviews${qs}`);
    },
    updateReview: (reviewId: number, data: { is_published?: boolean; title?: string; body?: string }) =>
      request<AdminReview>(`/admin/reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    createRefund: (data: { order_id: number; amount?: number; reason?: string }) =>
      request<JsonMap>('/payments/refund', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    categories: () => request<CatalogCategory[]>('/admin/categories'),
    collections: () => request<CatalogCollection[]>('/admin/collections'),
    createCollection: (data: Partial<CatalogCollection>) =>
      request<CatalogCollection>('/admin/collections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    createProductQuick: async (data: AdminProductQuickCreatePayload) =>
      normalizeProduct(await request<Product>('/admin/products/quick-create', {
        method: 'POST',
        body: JSON.stringify(data),
      })),
    uploadProductImage: (file: File) => {
      const body = new FormData();
      body.append('image', file);
      return request<{ image_url: string }>('/admin/product-images', {
        method: 'POST',
        body,
      });
    },
    orders: (params?: QueryParams) => {
      const qs = queryString(params);
      return request<PaginatedResponse<Order>>(`/admin/orders${qs}`);
    },
    inventory: () => request<AdminInventoryRow[]>('/admin/inventory'),
    adjustInventory: (data: { variant_id: number; quantity_delta: number; note?: string }) =>
      request<JsonMap>('/admin/inventory', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    shipments: () => request<AdminShipment[]>('/admin/shipments'),
    createShipment: (data: { order: number; provider: string; awb_number?: string; tracking_url?: string; label_url?: string; manifest_url?: string; shipping_charge?: number | string; rto_reason?: string; status?: AdminShipment['status']; raw_payload?: JsonMap; event_location?: string; event_note?: string }) =>
      request<AdminShipment>('/admin/shipments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    shipmentLabel: (shipmentId: number) => download(`/admin/shipments/${shipmentId}/label`),
    shipmentManifest: (shipmentId: number) => download(`/admin/shipments/${shipmentId}/manifest`),
    returns: () => request<ReturnRequest[]>('/admin/returns'),
    updateReturn: (returnId: number, data: { status: ReturnRequest['status'] }) =>
      request<ReturnRequest>(`/admin/returns/${returnId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    customers: () => request<JsonMap[]>('/admin/customers'),
    reports: () => request<JsonMap>('/admin/reports'),
    auditLogs: (params?: { action?: string; entity_type?: string; q?: string }) => {
      const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== '');
      const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
      return request<AdminAuditLog[]>(`/admin/audit-logs${qs}`);
    },
    unsold: () => request<UnsoldResponse>('/admin/unsold-alerts'),
    coupons: () => request<AdminCoupon[]>('/admin/coupons'),
    offers: () => request<AdminOffer[]>('/admin/offers'),
    createOffer: (data: Partial<AdminOffer>) =>
      request<AdminOffer>('/admin/offers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateOffer: (offerId: number, data: Partial<AdminOffer>) =>
      request<AdminOffer>(`/admin/offers/${offerId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteOffer: (offerId: number) =>
      request<void>(`/admin/offers/${offerId}`, { method: 'DELETE' }),
    createCoupon: (data: Partial<AdminCoupon>) =>
      request<AdminCoupon>('/admin/coupons', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateCoupon: (couponId: number, data: Partial<AdminCoupon>) =>
      request<AdminCoupon>(`/admin/coupons/${couponId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateOrderStatus: (orderId: number, data: JsonMap) =>
      request<Order>(`/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    workflowOrder: (orderId: number, data: { action: string; provider?: string; note?: string; location?: string }) =>
      request<Order>(`/admin/orders/${orderId}/workflow`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    orderInvoice: (orderId: number) => download(`/admin/orders/${orderId}/invoice`),
  },

  addresses: {
    list: () => request<Address[]>('/addresses'),
    create: (data: Address) =>
      request<Address>('/addresses', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  wishlist: {
    list: () => request<WishlistApiItem[]>('/wishlist'),
    toggle: (product_id: number) =>
      request<{ in_wishlist: boolean; item?: WishlistApiItem }>('/wishlist', {
        method: 'POST',
        body: JSON.stringify({ product_id }),
      }),
    remove: (slug: string) => request<void>(`/wishlist/${slug}`, { method: 'DELETE' }),
  },

  loyalty: {
    balance: () => request<JsonMap>('/loyalty/balance'),
    history: () => request<JsonMap[]>('/loyalty/history'),
    rewards: () => request<LoyaltyReward[]>('/loyalty/rewards'),
    redeem: (rewardId: number) => request<JsonMap>(`/loyalty/redeem/${rewardId}`, { method: 'POST' }),
  },

  notifications: {
    list: (params?: QueryParams) => {
      const qs = queryString(params);
      return request<NotificationListResponse>(`/notifications${qs}`);
    },
    count: () => request<{ unread_count: number }>('/notifications/count'),
    markRead: () => request<JsonMap>('/notifications', { method: 'PATCH' }),
  },
};

export { normalizeProduct };
