import { useEffect, useState } from 'react';

export interface PlpBannerSlide {
  image: string;
  kicker: string;
  title: string;
  text: string;
  cta?: { label: string; href: string; external?: boolean };
  tone?: 'pink' | 'gold' | 'ink';
}

export interface PlpCategoryTile {
  key: string;
  label: string;
  image: string;
}

interface PlpBannersProps {
  slides: PlpBannerSlide[];
  tiles: PlpCategoryTile[];
  activeCategory: string;
  onCategory: (key: string) => void;
}

const ROTATE_MS = 5000;

export function PlpBanners({ slides, tiles, activeCategory, onCategory }: PlpBannersProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % slides.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slide = slides[index] || slides[0];

  return (
    <div className="plp-top">
      {slide && (
        <div className={`plp-banner plp-banner--${slide.tone || 'pink'}`}>
          <img className="plp-banner-photo" src={slide.image} alt="" aria-hidden="true" loading="eager" />
          <div className="plp-banner-shade" aria-hidden="true" />
          <div className="plp-banner-copy">
            <span className="plp-banner-kicker">{slide.kicker}</span>
            <h2>{slide.title}</h2>
            <p>{slide.text}</p>
            {slide.cta && (
              <a
                className="plp-banner-cta"
                href={slide.cta.href}
                target={slide.cta.external ? '_blank' : undefined}
                rel={slide.cta.external ? 'noreferrer' : undefined}
              >
                {slide.cta.label}
              </a>
            )}
          </div>
          {slides.length > 1 && (
            <div className="plp-banner-dots" role="tablist" aria-label="Promotions">
              {slides.map((item, dotIndex) => (
                <button
                  key={item.title}
                  type="button"
                  role="tab"
                  aria-selected={dotIndex === index}
                  aria-label={item.title}
                  className={`plp-banner-dot ${dotIndex === index ? 'on' : ''}`}
                  onClick={() => setIndex(dotIndex)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tiles.length > 0 && (
        <div className="plp-tiles" role="navigation" aria-label="Shop by category">
          {tiles.map(tile => {
            const active = activeCategory === tile.key;
            return (
              <button
                key={tile.key}
                type="button"
                className={`plp-tile ${active ? 'active' : ''}`}
                onClick={() => onCategory(active ? '' : tile.key)}
              >
                <span className="plp-tile-ring">
                  <img src={tile.image} alt="" loading="lazy" />
                </span>
                <span className="plp-tile-label">{tile.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
