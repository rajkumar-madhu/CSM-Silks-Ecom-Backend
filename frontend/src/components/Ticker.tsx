export function Ticker() {
  const items = [
    'Free shipping above ₹999',
    'GI-tagged Kanjivaram silk',
    'Bridal edits now live',
    'New festive colors in',
    "Men's wedding sets",
    'Secure Razorpay checkout',
    '15-day easy returns',
    'WhatsApp styling help',
  ];
  const loop = [...items, ...items];

  return (
    <div className="ticker">
      <div className="ticker-inner">
        {loop.map((item, index) => (
          <div key={`${item}-${index}`} className="ti">
            {item}
            <div className="ti-dot" />
          </div>
        ))}
      </div>
    </div>
  );
}
