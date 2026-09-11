import { CatalogPlp, type CatalogPlpQuickLink } from '@/features/catalog/CatalogPlp';
import { DEFAULT_PLP_STATE } from '@/features/catalog/plpFilters';
import type { PlpBannerSlide, PlpCategoryTile } from '@/features/catalog/components/PlpBanners';

const SLIDES: PlpBannerSlide[] = [
  {
    image: '/images/catalog/hero-women.jpg',
    kicker: 'Women’s edit',
    title: 'Most loved silk sarees',
    text: 'Handwoven Kanjivaram, bridal, festive, and daily edits with live stock.',
    tone: 'pink',
  },
  {
    image: '/images/catalog/bridal-ruby.jpg',
    kicker: 'Wedding season',
    title: 'Bridal Kanjivarams',
    text: 'GI-tagged pure zari weaves for the big day.',
    cta: { label: 'Shop bridal', href: '/womens?category=bridal' },
    tone: 'gold',
  },
  {
    image: '/images/catalog/banarasi-brocade.jpg',
    kicker: 'New arrivals',
    title: 'Banarasi brocades',
    text: 'Fresh looms just landed — first pick before they sell out.',
    cta: { label: 'Shop new', href: '/womens?category=banarasi&sort=newest' },
    tone: 'ink',
  },
];

const TILES: PlpCategoryTile[] = [
  { key: 'kanjivaram', label: 'Kanjivaram', image: '/images/catalog/royal-kanjivaram.jpg' },
  { key: 'bridal', label: 'Bridal', image: '/images/catalog/bridal-ruby.jpg' },
  { key: 'festive', label: 'Festive', image: '/images/catalog/temple-kanjivaram.jpg' },
  { key: 'patola', label: 'Patola', image: '/images/catalog/patola-ikat.jpg' },
  { key: 'daily', label: 'Daily wear', image: '/images/catalog/daily-pastel.jpg' },
  { key: 'mysore', label: 'Mysore', image: '/images/catalog/mysore-emerald.jpg' },
  { key: 'banarasi', label: 'Banarasi', image: '/images/catalog/banarasi-brocade.jpg' },
];

const QUICK_LINKS: CatalogPlpQuickLink[] = [
  {
    key: 'bridal-edit',
    label: 'Bridal Edit',
    note: 'Kanjivarams for wedding wardrobes',
    isActive: state => state.category === 'bridal',
    buildState: state => ({ ...state, category: 'bridal' }),
    clearState: state => ({ ...state, category: '' }),
  },
  {
    key: 'under-5000',
    label: 'Under ₹5,000',
    note: 'Daily wear and gifting picks',
    isActive: state => state.minPrice === '' && state.maxPrice === '5000',
    buildState: state => ({ ...state, minPrice: '', maxPrice: '5000' }),
    clearState: state => ({ ...state, minPrice: '', maxPrice: '' }),
  },
  {
    key: 'festive',
    label: 'Festive Colour',
    note: 'Bold borders and celebratory drapes',
    isActive: state => state.category === 'festive',
    buildState: state => ({ ...state, category: 'festive' }),
    clearState: state => ({ ...state, category: '' }),
  },
  {
    key: 'discounts',
    label: '25%+ Off',
    note: 'High-discount sarees in stock now',
    isActive: state => state.discountMin === '25',
    buildState: state => ({ ...state, discountMin: '25' }),
    clearState: state => ({ ...state, discountMin: '' }),
  },
  {
    key: 'new-arrivals',
    label: 'Fresh Arrivals',
    note: 'Latest drops at the top of the grid',
    isActive: state => state.sort === 'newest',
    buildState: state => ({ ...state, sort: 'newest' }),
    clearState: state => ({ ...state, sort: DEFAULT_PLP_STATE.sort }),
  },
];

export function Womens() {
  return (
    <CatalogPlp
      gender="women"
      title="Sarees for Women"
      description="Marketplace-style browsing across bridal, festive, premium, and daily silk edits with live stock, dense filtering, and fast sorting."
      slides={SLIDES}
      tiles={TILES}
      quickLinks={QUICK_LINKS}
    />
  );
}
