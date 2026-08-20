export const STORE_PHONE_E164 = (import.meta.env.VITE_STORE_PHONE || '919876543210').replace(/\D/g, '');
export const STORE_PHONE_DISPLAY = import.meta.env.VITE_STORE_PHONE_DISPLAY || '+91 98765 43210';
export const STORE_PHONE_TEL = `+${STORE_PHONE_E164}`;
export const STORE_WHATSAPP_URL = `https://wa.me/${STORE_PHONE_E164}`;

export function productWhatsAppUrl(product: { name: string; sku?: string; price?: number | string }) {
  const price = Number(product.price || 0);
  const lines = [
    `Vanakkam CSM Silks — I am looking at ${product.name}.`,
    product.sku ? `SKU: ${product.sku}` : '',
    price ? `Price: Rs ${price.toLocaleString('en-IN')}` : '',
    'Could you help with availability, blouse stitching, and shipping?',
  ].filter(Boolean);
  return `${STORE_WHATSAPP_URL}?text=${encodeURIComponent(lines.join('\n'))}`;
}
