import { CatalogPlp } from '@/features/catalog/CatalogPlp';
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

export function Womens() {
  return <CatalogPlp gender="women" title="Sarees for Women" slides={SLIDES} tiles={TILES} />;
}
