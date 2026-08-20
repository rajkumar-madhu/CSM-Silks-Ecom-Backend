import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Heart, MapPin, Menu, Moon, Search, ShoppingBag, Sun, UserRound, X } from 'lucide-react';
import { BrandMark } from '@/ui/components';
import { getDeliveryPin, normalizeDeliveryPin, setDeliveryPin, DELIVERY_PIN_EVENT } from '@/lib/deliveryPin';
import { useApp } from '@/store/AppContext';
import { useTheme } from '@/store/ThemeContext';

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { cartCount, unreadNotifications, isAuthed } = useApp();
  const { isDark, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [deliveryPin, setDeliveryPinState] = useState(getDeliveryPin);
  const [pinEditorOpen, setPinEditorOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState(deliveryPin);

  useEffect(() => {
    const onPinChange = (event: Event) => {
      const next = normalizeDeliveryPin((event as CustomEvent<string>).detail || getDeliveryPin());
      setDeliveryPinState(next);
      setPinDraft(next);
    };
    window.addEventListener(DELIVERY_PIN_EVENT, onPinChange);
    return () => window.removeEventListener(DELIVERY_PIN_EVENT, onPinChange);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('scroll-locked');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('scroll-locked');
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  const closeAndGo = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const primaryLinks = [
    { path: '/womens', label: 'Women', match: (p: string, s: string) => p.startsWith('/womens') && !s.includes('category=bridal') && !s.includes('category=festive') },
    { path: '/mens', label: 'Men', match: (p: string) => p.startsWith('/mens') },
    { path: '/womens?category=bridal', label: 'Bridal', match: (_p: string, s: string) => s.includes('category=bridal') },
    { path: '/womens?category=festive', label: 'New in', match: (_p: string, s: string) => s.includes('category=festive') },
    { path: '/tracking', label: 'Track order', match: (p: string) => p.startsWith('/tracking') },
  ];

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    navigate(nextQuery ? `/search?q=${encodeURIComponent(nextQuery)}` : '/search');
    setMobileOpen(false);
  };

  const submitDeliveryPin = (event: FormEvent) => {
    event.preventDefault();
    const next = setDeliveryPin(pinDraft);
    setDeliveryPinState(next);
    setPinEditorOpen(false);
  };

  return (
    <>
      <nav className="nav nav--union">
        <button type="button" className="nav-logo" onClick={() => navigate('/')} aria-label="Go to CSM Silks home">
          <BrandMark />
        </button>

        <div className="nav-primary">
          {primaryLinks.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`nav-primary-link ${item.match(location.pathname, location.search) ? 'on' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form className="nav-search" onSubmit={submitSearch}>
          <Search size={18} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sarees, dhotis, silk shirts" />
          <button type="submit">Search</button>
        </form>

        <div className="nav-actions">
          <div className="nav-location-wrap">
            <button
              type="button"
              className="nav-location"
              onClick={() => {
                setPinDraft(deliveryPin);
                setPinEditorOpen(open => !open);
              }}
              aria-expanded={pinEditorOpen}
              aria-label="Update delivery PIN code"
            >
              <MapPin size={15} />
              <span>{deliveryPin || 'PIN'}</span>
            </button>
            {pinEditorOpen && (
              <form className="nav-pin-editor" onSubmit={submitDeliveryPin}>
                <input
                  value={pinDraft}
                  onChange={event => setPinDraft(normalizeDeliveryPin(event.target.value))}
                  placeholder="6-digit PIN"
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="Delivery PIN code"
                />
                <button type="submit">Update</button>
              </form>
            )}
          </div>

          <button
            type="button"
            className="nav-icon-btn theme-toggle"
            onClick={toggleTheme}
            aria-pressed={isDark}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button type="button" className="nav-icon-btn" onClick={() => navigate('/notifications')} aria-label="Notifications">
            <Bell size={18} />
            {unreadNotifications > 0 && <span className="nav-badge subtle">{unreadNotifications}</span>}
          </button>
          <button type="button" className="nav-icon-btn" onClick={() => navigate('/wishlist')} aria-label="Wishlist">
            <Heart size={18} />
          </button>
          <button type="button" className="nav-icon-btn" onClick={() => navigate('/cart')} aria-label="Cart">
            <ShoppingBag size={18} />
            {cartCount > 0 && <span className="nav-badge">{cartCount}</span>}
          </button>
          <button type="button" className="nav-icon-btn" onClick={() => navigate(isAuthed ? '/account' : '/login')} aria-label={isAuthed ? 'Account' : 'Login'}>
            <UserRound size={18} />
          </button>
          <button type="button" className="nav-mob-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
        </div>
      </nav>

      <button
        type="button"
        className={`mob-menu-backdrop ${mobileOpen ? 'on' : ''}`}
        aria-label="Close menu"
        onClick={() => setMobileOpen(false)}
      />

      <div className={`mob-menu ${mobileOpen ? 'on' : ''}`} role="dialog" aria-modal="true" aria-label="Mobile navigation menu">
        <button type="button" className="mob-menu-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X size={20} />
        </button>
        <BrandMark />
        <form className="mm-search" onSubmit={submitSearch}>
          <Search size={18} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search sarees, dhotis, silk shirts"
          />
          <button type="submit">Go</button>
        </form>
        {primaryLinks.map((item) => (
          <button type="button" key={item.label} className="mm-link" onClick={() => closeAndGo(item.path)}>
            {item.label}
          </button>
        ))}
        <button type="button" className="mm-link" onClick={() => closeAndGo('/orders')}>
          My orders
        </button>
        <button type="button" className="mm-link" onClick={() => closeAndGo('/wishlist')}>
          Wishlist
        </button>
        <button type="button" className="mm-link" onClick={() => closeAndGo('/notifications')}>
          Notifications
          {unreadNotifications > 0 && <span className="mm-badge">{unreadNotifications}</span>}
        </button>
        <button type="button" className="mm-link" onClick={() => closeAndGo(isAuthed ? '/account' : '/login')}>
          {isAuthed ? 'Account' : 'Login / Signup'}
        </button>
        <button type="button" className="mm-link" onClick={toggleTheme} aria-pressed={isDark}>
          {isDark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </>
  );
}
