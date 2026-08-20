import { CatalogPlp } from '@/features/catalog/CatalogPlp';
import type { PlpBannerSlide, PlpCategoryTile } from '@/features/catalog/components/PlpBanners';
import { STORE_WHATSAPP_URL } from '@/lib/storeContact';

const SLIDES: PlpBannerSlide[] = [
  {
    image: '/images/catalog/hero-men.jpg',
    kicker: 'Men’s edit',
    title: 'Silk wear for Indian occasions',
    text: 'Pure silk dhotis, veshtis, shirts, and wedding sets from the CSM loom standard.',
    tone: 'ink',
  },
  {
    image: '/images/catalog/dhoti-gold.jpg',
    kicker: 'Wedding ready',
    title: 'Dhotis & veshti sets',
    text: 'Coordinated occasion sets with variant-level size and stock.',
    cta: { label: 'Shop sets', href: '/mens?category=set' },
    tone: 'gold',
  },
  {
    image: '/images/catalog/kurta-ivory.jpg',
    kicker: 'Need help?',
    title: 'WhatsApp a stylist',
    text: 'Size, drape, or occasion questions — a CSM stylist replies on WhatsApp.',
    cta: {
      label: 'Chat now',
      href: `${STORE_WHATSAPP_URL}?text=${encodeURIComponent("Hi CSM Silks, I need men's silk help.")}`,
      external: true,
    },
    tone: 'pink',
  },
];

const TILES: PlpCategoryTile[] = [
  { key: 'dhoti', label: 'Silk dhotis', image: '/images/catalog/dhoti-gold.jpg' },
  { key: 'veshti', label: 'Veshtis', image: '/images/catalog/veshti-kanjivaram.jpg' },
  { key: 'shirt', label: 'Silk shirts', image: '/images/catalog/shirt-forest.jpg' },
  { key: 'set', label: 'Wedding sets', image: '/images/catalog/kurta-ivory.jpg' },
  { key: 'panch', label: 'Panchakacham', image: '/images/catalog/kurta-mustard.jpg' },
];

export function Mens() {
  return <CatalogPlp gender="men" title="Men's Silk Wear" slides={SLIDES} tiles={TILES} />;
}
