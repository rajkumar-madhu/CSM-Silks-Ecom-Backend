/** Every rupee amount the storefront prints goes through here.
 *
 *  Two things used to drift: the symbol (a handful of files wrote "₹", most wrote "Rs ") and the
 *  grouping, which has to be en-IN — an Indian shopper reads 12,499 and 12,50,000, not 12.499 and
 *  1,250,000. A missing or non-numeric amount renders as ₹0 rather than "₹NaN", because these
 *  strings land in carts, invoices and WhatsApp messages where a broken number is worse than a
 *  wrong-looking zero. */
export function inr(value: number | string | null | undefined): string {
  const amount = Number(value);
  return `₹${(Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN')}`;
}
