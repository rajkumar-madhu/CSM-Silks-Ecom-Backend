import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, MapPin, MessageCircle, ShieldCheck, Star, Store, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { OccasionRail } from '@/features/catalog/components/OccasionRail';
import { api } from '@/lib/api';
import type { Product } from '@/types';

type GenderTab = 'women' | 'men';
type ProductTab = 'bestsellers' | 'newin';

const heroSlides = [
  {
    kicker: 'Wear the silk',
    title: "Women's ethnic fusion",
    subtitle: 'Kanjivaram, bridal zari, and festive edits',
    path: '/womens',
    tone: 'ruby' as const,
    gender: 'women' as const,
    image: '/images/catalog/hero-women.jpg',
  },
  {
    kicker: 'Crafted for him',
    title: "Men's silk wear",
    subtitle: 'Dhotis, veshtis, shirts, and wedding sets',
    path: '/mens',
    tone: 'green' as const,
    gender: 'men' as const,
    image: '/images/catalog/hero-men.jpg',
  },
  {
    kicker: 'Bridal season',
    title: 'Wedding silk edits',
    subtitle: 'Heirloom sarees with blouse pairing',
    path: '/womens?category=bridal',
    tone: 'gold' as const,
    gender: 'women' as const,
    image: '/images/catalog/bridal-ruby.jpg',
  },
];

const stats = [
  { icon: Store, value: '50+', label: 'Years of silk craft' },
  { icon: ShieldCheck, value: 'GI', label: 'Tagged authenticity' },
  { icon: Star, value: '4.8+', label: 'Customer rating' },
  { icon: Truck, value: 'PAN', label: 'India delivery' },
];

const collectionBanners = [
  { title: 'Kanjivaram sarees', path: '/womens?category=kanjivaram', tone: 'ruby' as const },
  { title: 'Bridal collection', path: '/womens?category=bridal', tone: 'gold' as const },
  { title: "Men's wedding sets", path: '/mens?category=set', tone: 'green' as const },
];

const categoryChips = [
  { label: 'Kanjivaram', path: '/womens?category=kanjivaram' },
  { label: 'Bridal', path: '/womens?category=bridal' },
  { label: 'Festive', path: '/womens?category=festive' },
  { label: 'Daily silk', path: '/womens?category=daily' },
  { label: 'Dhotis', path: '/mens?category=dhoti' },
  { label: 'Veshtis', path: '/mens?category=veshti' },
  { label: 'Silk shirts', path: '/mens?category=shirt' },
  { label: 'Wedding sets', path: '/mens?category=set' },
];

export function Home() {
  const navigate = useNavigate();
  const [activeSlide, setActiveSlide] = useState(0);
  const [genderTab, setGenderTab] = useState<GenderTab>('women');
  const [productTab, setProductTab] = useState<ProductTab>('bestsellers');
  const [womenBestsellers, setWomenBestsellers] = useState<Product[]>([]);
  const [womenNew, setWomenNew] = useState<Product[]>([]);
  const [menBestsellers, setMenBestsellers] = useState<Product[]>([]);
  const [menNew, setMenNew] = useState<Product[]>([]);

  useEffect(() => {
    Promise.all([
      api.products.list({ gender: 'women', featured: true, per_page: 8 }),
      api.products.list({ gender: 'women', sort: 'newest', per_page: 8 }),
      api.products.list({ gender: 'men', featured: true, per_page: 8 }),
      api.products.list({ gender: 'men', sort: 'newest', per_page: 8 }),
    ]).then(([wb, wn, mb, mn]) => {
      setWomenBestsellers(wb.items);
      setWomenNew(wn.items);
      setMenBestsellers(mb.items);
      setMenNew(mn.items);
    }).catch(() => {
      setWomenBestsellers([]);
      setWomenNew([]);
      setMenBestsellers([]);
      setMenNew([]);
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide(current => (current + 1) % heroSlides.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, []);

  const lovedProducts = useMemo(() => {
    if (genderTab === 'women') {
      return productTab === 'bestsellers' ? womenBestsellers : womenNew;
    }
    return productTab === 'bestsellers' ? menBestsellers : menNew;
  }, [genderTab, productTab, womenBestsellers, womenNew, menBestsellers, menNew]);

  const moveSlide = (direction: -1 | 1) => {
    setActiveSlide(current => (current + direction + heroSlides.length) % heroSlides.length);
  };

  const viewAllPath = genderTab === 'women' ? '/womens' : '/mens';

  return (
    <div className="storefront storefront--union">
      <section className="su-hero" aria-label="Featured collections">
        <div className="su-hero-track" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
          {heroSlides.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              className={`su-hero-slide su-hero-slide--${slide.tone}`}
              onClick={() => navigate(slide.path)}
              aria-label={`Shop ${slide.title}`}
            >
              <img className="su-hero-slide-photo" src={slide.image} alt="" aria-hidden="true" />
              <div className="su-hero-slide-shade" aria-hidden="true" />
              <div className="su-hero-slide-copy">
                <span>{slide.kicker}</span>
                <h1>{slide.title}</h1>
                <p>{slide.subtitle}</p>
                <em>Shop now</em>
              </div>
              <span className="su-hero-slide-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </div>

        <div className="su-hero-controls">
          <button type="button" className="su-hero-nav" onClick={() => moveSlide(-1)} aria-label="Previous slide">
            <ChevronLeft size={20} />
          </button>
          <div className="su-hero-dots" role="tablist" aria-label="Hero slides">
            {heroSlides.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                role="tab"
                aria-selected={activeSlide === index}
                className={activeSlide === index ? 'on' : ''}
                onClick={() => setActiveSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
          <button type="button" className="su-hero-nav" onClick={() => moveSlide(1)} aria-label="Next slide">
            <ChevronRight size={20} />
          </button>
        </div>

        <a className="su-hero-scroll" href="#most-loved">
          <ArrowDown size={18} />
          Scroll
        </a>
      </section>

      <section className="su-stats" aria-label="Store highlights">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="su-stat">
              <Icon size={22} aria-hidden="true" />
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          );
        })}
      </section>

      <section className="su-loved" id="most-loved">
        <div className="su-loved-head">
          <div className="su-loved-title">
            <span>{genderTab === 'men' ? 'Men' : 'Women'}</span>
            <h2>
              Most
              <br />
              Loved
              <br />
              styles
            </h2>
          </div>

          <div className="su-loved-controls">
            <div className="su-gender-tabs" role="tablist" aria-label="Shop by gender">
              <button
                type="button"
                role="tab"
                aria-selected={genderTab === 'men'}
                className={genderTab === 'men' ? 'on' : ''}
                onClick={() => setGenderTab('men')}
              >
                Men
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={genderTab === 'women'}
                className={genderTab === 'women' ? 'on' : ''}
                onClick={() => setGenderTab('women')}
              >
                Women
              </button>
            </div>

            <div className="su-product-tabs" role="tablist" aria-label="Product filters">
              <button
                type="button"
                role="tab"
                aria-selected={productTab === 'bestsellers'}
                className={productTab === 'bestsellers' ? 'on' : ''}
                onClick={() => setProductTab('bestsellers')}
              >
                Best sellers
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={productTab === 'newin'}
                className={productTab === 'newin' ? 'on' : ''}
                onClick={() => setProductTab('newin')}
              >
                New in
              </button>
            </div>

            <button type="button" className="su-view-all" onClick={() => navigate(viewAllPath)}>
              View all <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <div className="su-product-rail" key={`${genderTab}-${productTab}`}>
          {lovedProducts.length > 0 ? (
            lovedProducts.map(product => (
              <ProductCard key={product.id} product={product} layout="retail" />
            ))
          ) : (
            <div className="su-empty-rail">
              <p>Live catalog picks will appear here once products are published.</p>
              <button type="button" className="btn btn-primary" onClick={() => navigate(viewAllPath)}>
                Browse {genderTab === 'women' ? 'women' : 'men'}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="su-banners" aria-label="Shop by collection">
        {collectionBanners.map((banner) => (
          <button
            key={banner.title}
            type="button"
            className={`su-banner su-banner--${banner.tone}`}
            onClick={() => navigate(banner.path)}
          >
            <span>Collection</span>
            <strong>{banner.title}</strong>
            <em>Explore <ArrowRight size={16} /></em>
          </button>
        ))}
      </section>

      <OccasionRail />

      <section className="su-categories">
        <div className="su-categories-head">
          <h3>Shop by category</h3>
          <p>Quick entry points across women&apos;s sarees and men&apos;s silk.</p>
        </div>
        <div className="su-category-chips">
          {categoryChips.map(chip => (
            <button key={chip.label} type="button" onClick={() => navigate(chip.path)}>
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      <section className="su-assist">
        <div>
          <span>Need help choosing?</span>
          <h3>Talk to our silk stylist on WhatsApp</h3>
          <p>Share occasion, budget, and color preference. We help with sizing, blouse pairing, and delivery timelines.</p>
        </div>
        <div className="su-assist-actions">
          <a className="btn btn-primary" href="https://wa.me/919876543210?text=Hi%20CSM%20Silks%2C%20I%20need%20help%20choosing%20silk." target="_blank" rel="noreferrer noopener">
            <MessageCircle size={17} /> WhatsApp
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/tracking')}>
            <MapPin size={17} /> Track order
          </button>
        </div>
      </section>
    </div>
  );
}