export interface ProductImageRecord {
  id: number;
  variant_id?: number | null;
  image_url: string;
  alt_text?: string;
  sort_order: number;
  is_primary?: boolean;
}

export interface ProductVariant {
  id: number;
  sku: string;
  title?: string;
  color_name?: string;
  color_hex?: string;
  size?: string;
  fabric?: string;
  zari_type?: string;
  length_meters?: number | string | null;
  care_instructions?: string;
  blouse_included?: boolean;
  price: number | string;
  mrp: number | string;
  stock_qty: number;
  reserved_qty?: number;
  available_qty: number;
  is_active?: boolean;
}

export interface CatalogCategory {
  id: number;
  name: string;
  slug: string;
  gender: Product['gender'];
  parent_id?: number | null;
  sort_order?: number;
}

export interface CatalogCollection {
  id: number;
  name: string;
  slug: string;
  description?: string;
  is_featured?: boolean;
  sort_order?: number;
}

export interface Product {
  id: number;
  slug: string;
  variant_id?: number;
  default_variant_id?: number;
  name: string;
  name_tamil?: string;
  cat: string;
  category_slug?: string;
  price: number;
  mrp: number;
  badge: string;
  'badge-text': string;
  emoji: string;
  bg: string;
  hook: string;
  description?: string;
  brand?: string;
  seller_name?: string;
  deal_label?: string;
  colors: string[];
  colours?: string[];
  gender: 'women' | 'men' | 'unisex';
  tags: string[];
  occasions?: string[];
  images?: string[];
  image_records?: ProductImageRecord[];
  collections?: CatalogCollection[];
  variants?: ProductVariant[];
  available_qty?: number;
  is_active?: boolean;
  is_featured?: boolean;
  is_gi_tagged?: boolean;
  assured?: boolean;
  cod_available?: boolean;
  exchange_available?: boolean;
  return_days?: number;
  delivery_min_days?: number;
  delivery_max_days?: number;
  key_highlights?: string[];
  specifications?: Record<string, string>;
  attributes?: Array<{ key: string; label: string; value: string }>;
  attribute_labels?: string[];
  serviceable_pin_codes?: string[];
  discount_percent?: number;
  avg_rating?: number | string;
  review_count?: number;
  total_sold?: number;
  length_meters?: number | string | null;
}

export interface AdminProductQuickCreatePayload {
  name: string;
  slug?: string;
  gender: Product['gender'];
  category_name: string;
  category_slug?: string;
  collection_name?: string;
  collection_slug?: string;
  collection_description?: string;
  hook?: string;
  description?: string;
  tags_text?: string;
  occasions_text?: string;
  price: number;
  mrp: number;
  cost_price?: number;
  stock_qty: number;
  sku?: string;
  color_name?: string;
  color_hex?: string;
  size?: string;
  fabric?: string;
  zari_type?: string;
  blouse_included?: boolean;
  image_url?: string;
  alt_text?: string;
  deal_label?: string;
  is_featured?: boolean;
  is_active?: boolean;
  assured?: boolean;
  cod_available?: boolean;
  exchange_available?: boolean;
  return_days?: number;
}

export interface CartItem extends Product {
  qty: number;
  cart_item_id?: number;
  variant_sku?: string;
  variant_available_qty?: number;
  variant_stock_qty?: number;
  variant_reserved_qty?: number;
  stock_status?: 'ok' | 'inactive' | 'out_of_stock' | 'insufficient';
  stock_message?: string;
}

export interface ApiCartItem {
  id: number;
  product_id: number;
  variant_id: number;
  variant_sku?: string;
  quantity: number;
  variant_available_qty?: number;
  variant_stock_qty?: number;
  variant_reserved_qty?: number;
  stock_status?: CartItem['stock_status'];
  stock_message?: string;
  product: Product;
  line_total: number | string;
}

export interface CartStockIssue {
  item_id: number;
  variant_id: number;
  sku: string;
  requested_qty: number;
  available_qty: number;
  status: 'inactive' | 'out_of_stock' | 'insufficient';
  message: string;
}

export interface CartResponse {
  id?: number;
  items: ApiCartItem[];
  item_count: number;
  has_stock_issues?: boolean;
  stock_issues?: CartStockIssue[];
  subtotal: number | string;
  discount?: number | string;
  coupon_code?: string;
  cgst: number | string;
  sgst: number | string;
  shipping?: number | string;
  total: number | string;
  free_shipping: boolean;
}

export interface CartQuoteFinishing {
  cart_item_id: number;
  blouse_stitching: boolean;
  blouse_size: string;
  fall_pico: boolean;
}

export interface CartQuoteRequest {
  finishing?: CartQuoteFinishing[];
  coupon_code?: string;
  loyalty_points_to_use?: number;
}

/** Server-computed checkout totals. Money fields are exact decimal strings. */
export interface CartQuote {
  goods_subtotal: string;
  finishing_total: string;
  subtotal: string;
  coupon_discount: string;
  loyalty_discount: string;
  taxable: string;
  cgst: string;
  sgst: string;
  shipping: string;
  total: string;
  loyalty_points_earned: number;
}

export interface OrderItem {
  id: number;
  product_id: number;
  variant_id: number;
  product?: Product;
  product_name: string;
  product_sku: string;
  unit_price: number | string;
  quantity: number;
  subtotal: number | string;
  blouse_stitching?: boolean;
  blouse_size?: string;
  fall_pico?: boolean;
}

export interface TrackingEvent {
  id: number;
  status: string;
  title: string;
  description: string;
  location?: string;
  happened_at: string;
  raw_payload?: Record<string, unknown>;
  created_at?: string;
}

export interface Order {
  id: number;
  order_number: string;
  status: 'pending' | 'payment_pending' | 'confirmed' | 'quality_check' | 'packed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'rto_initiated' | 'rto_delivered' | 'cancelled' | 'return_initiated' | 'returned' | 'refunded';
  payment_method?: string;
  payment_status?: string;
  subtotal: number | string;
  discount_amount: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  shipping_amount: number | string;
  finishing_amount?: number | string;
  occasion_note?: string;
  total_amount: number | string;
  courier_name?: string;
  tracking_number?: string;
  courier_url?: string;
  tracking_url?: string;
  estimated_delivery?: string;
  created_at: string;
  confirmed_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  tracking_events?: TrackingEvent[];
  items: OrderItem[];
}

export interface AdminInventoryRow {
  variant_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  stock_qty: number;
  reserved_qty: number;
  available_qty: number;
  reorder_level: number;
  low_stock: boolean;
}

export interface AdminShipment {
  id: number;
  order: number;
  order_number: string;
  provider: string;
  awb_number: string;
  tracking_url: string;
  label_url?: string;
  manifest_url?: string;
  shipping_charge?: number | string;
  rto_reason?: string;
  status: 'created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed' | 'rto_initiated' | 'rto_delivered';
  raw_payload?: Record<string, unknown>;
  events?: TrackingEvent[];
  created_at: string;
  updated_at: string;
}

export interface AdminReview {
  id: number;
  product: number;
  product_name: string;
  product_slug: string;
  rating: number;
  title: string;
  body: string;
  customer: string;
  customer_email?: string | null;
  is_verified_purchase: boolean;
  is_published: boolean;
  created_at: string;
}

export interface AdminCoupon {
  id: number;
  code: string;
  description?: string;
  discount_type: 'flat' | 'percent';
  value: number | string;
  min_order_value: number | string;
  usage_limit?: number | null;
  used_count: number;
  starts_at?: string | null;
  expires_at?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminAuditLog {
  id: number;
  user?: number | null;
  user_name: string;
  user_email?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
}

export interface ReturnRequest {
  id: number;
  order: number;
  order_number: string;
  customer: string;
  reason: string;
  details?: string;
  status: 'requested' | 'approved' | 'rejected' | 'picked_up' | 'refunded';
  created_at: string;
  updated_at: string;
}

export interface Address {
  id?: number;
  label?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone: string;
  address_line_1?: string;
  address_line_2?: string;
  address_line1?: string;
  address_line2?: string;
  city: string;
  state: string;
  pin_code?: string;
  pincode?: string;
  country?: string;
  email?: string;
  is_default?: boolean;
}

export interface User {
  id?: number;
  phone?: string;
  name?: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
  role?: string;
  loyalty_points?: number;
  loyalty_tier?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages?: number;
}

export interface TryOnData {
  skin: string;
  body: string;
  drape: string;
}

export type PaymentMethod = 'razorpay' | 'cod';

export interface CartTotals {
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  shipping: number;
  total: number;
}

export interface Toast {
  id: number;
  icon: string;
  title: string;
  msg: string;
}

export interface CatalogAttributeOption {
  slug: string;
  label: string;
  count: number;
}

export interface CatalogAttributeGroup {
  key: string;
  label: string;
  options: CatalogAttributeOption[];
}

export interface CatalogFacets {
  categories: CatalogCategory[];
  colors: Array<{ color_name: string; color_hex: string; count?: number }>;
  fabrics: string[];
  occasions: string[];
  price: { min_price: number | string | null; max_price: number | string | null };
  sorts: Array<{ key: string; label: string }>;
  total?: number;
  category_counts?: Record<string, number>;
  fabric_counts?: Array<{ name: string; count: number }>;
  occasion_counts?: Array<{ name: string; count: number }>;
  attributes?: CatalogAttributeGroup[];
}

export interface DeliveryCheck {
  pin_code: string;
  serviceable: boolean;
  message: string;
  eta_min: string;
  eta_max: string;
  cod_available: boolean;
  exchange_available: boolean;
  return_days: number;
  seller_name: string;
  assured: boolean;
}

export interface ProductReview {
  id: number;
  product: number;
  rating: number;
  title: string;
  body: string;
  customer: string;
  is_verified_purchase: boolean;
  created_at: string;
}

export interface LoyaltyReward {
  id: number;
  name: string;
  description: string;
  points_required: number;
  reward_type?: string;
  reward_value?: number | string;
  is_active?: boolean;
}

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  notification_type?: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at?: string;
}
