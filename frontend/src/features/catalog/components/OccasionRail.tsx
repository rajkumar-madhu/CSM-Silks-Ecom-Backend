import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { CatalogOccasion } from '@/types';

/**
 * Occasion-led discovery: "shop for a Wedding / Festival / Pooja".
 *
 * A saree is bought for an event far more often than for a fabric, so this is the way in
 * that matches how customers actually shop. Every card comes from live inventory — the
 * name, the count and the photograph are all borrowed from products that carry that
 * occasion — so the row can never advertise an occasion with nothing behind it.
 */

// Enough to fill a row without spilling into a second, sparse one.
const MAX_CARDS = 5;
// Below this an "occasion" is one stray product, not a collection worth a card.
const MIN_PRODUCTS = 2;

export function OccasionRail({ gender = 'women' }: { gender?: 'women' | 'men' }) {
  const [occasions, setOccasions] = useState<CatalogOccasion[] | null>(null);

  useEffect(() => {
    let live = true;
    api.products
      .occasions({ gender, limit: MAX_CARDS })
      .then(rows => {
        if (live) setOccasions(rows.filter(row => row.count >= MIN_PRODUCTS));
      })
      // A merchandising row is not worth an error state: if it cannot load, the page
      // simply carries on without it.
      .catch(() => {
        if (live) setOccasions([]);
      });
    return () => {
      live = false;
    };
  }, [gender]);

  // Render nothing at all rather than a heading over an empty rail.
  if (!occasions || occasions.length === 0) return null;

  return (
    <section className="occasion-rail">
      <div className="occasion-rail-head">
        <span className="occasion-rail-kicker">Shop by occasion</span>
        <h2>Woven for the days that matter</h2>
      </div>
      <div className="occasion-rail-grid">
        {occasions.map(occasion => (
          <Link
            key={occasion.name}
            to={`/${gender === 'men' ? 'mens' : 'womens'}?occasions=${encodeURIComponent(occasion.name)}`}
            className="occasion-card"
          >
            {occasion.image ? (
              <img src={occasion.image} alt="" aria-hidden="true" loading="lazy" />
            ) : (
              <span className="occasion-card-fallback" aria-hidden="true" />
            )}
            <span className="occasion-card-shade" aria-hidden="true" />
            <span className="occasion-card-body">
              <strong>{occasion.name}</strong>
              <em>
                {occasion.count} {occasion.count === 1 ? 'design' : 'designs'}
              </em>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
