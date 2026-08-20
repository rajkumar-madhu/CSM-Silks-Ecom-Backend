import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minimize2, RotateCw } from 'lucide-react';
import type { Product } from '@/types';
import { ProductVisual } from './ProductVisual';

interface SpinViewerProps {
  images: string[];
  index: number;
  onIndexChange: (next: number) => void;
  product?: Partial<Product>;
  className?: string;
}

const DEG_PER_PX = 0.48;
const AUTOPLAY_DEG = 0.32;
const FRICTION = 0.935;

/**
 * True CSS 3D orbit of the selected product photo (drag, inertia, autoplay).
 * Gallery thumbs still pick which still is on the turntable — they are not
 * treated as sequential turntable frames.
 */
export function SpinViewer({ images, index, onIndexChange, product, className = '' }: SpinViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(12);
  const velRef = useRef(0);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const autoplayRef = useRef(true);
  // Autoplay used to run forever, calling setAngle at 60fps for as long as the page
  // stayed open and re-rendering both ProductVisual subtrees every frame. Stop it after
  // one full revolution — the affordance is shown, the loop then idles.
  const autoplayTravelRef = useRef(0);
  const [angle, setAngle] = useState(12);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const currentImage = images[Math.min(index, Math.max(images.length - 1, 0))];

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) autoplayRef.current = false;
    let raf = 0;
    const tick = () => {
      if (!draggingRef.current) {
        let next = angleRef.current;
        if (autoplayRef.current && !reduced) {
          next += AUTOPLAY_DEG;
          autoplayTravelRef.current += AUTOPLAY_DEG;
          if (autoplayTravelRef.current >= 360) autoplayRef.current = false;
        } else if (Math.abs(velRef.current) > 0.04) {
          next += velRef.current;
          velRef.current *= FRICTION;
        } else {
          velRef.current = 0;
        }
        if (next !== angleRef.current) {
          angleRef.current = next;
          setAngle(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const stopAutoplay = () => {
    autoplayRef.current = false;
    setHint(false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopAutoplay();
    draggingRef.current = true;
    velRef.current = 0;
    lastXRef.current = event.clientX;
    lastTRef.current = event.timeStamp;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = event.clientX - lastXRef.current;
    const dt = Math.max(8, event.timeStamp - lastTRef.current);
    const delta = dx * DEG_PER_PX;
    angleRef.current += delta;
    velRef.current = delta * (16 / dt);
    lastXRef.current = event.clientX;
    lastTRef.current = event.timeStamp;
    setAngle(angleRef.current);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleFullscreen = async () => {
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await node.requestFullscreen();
      }
    } catch {
      /* browser blocked fullscreen */
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    stopAutoplay();
    const step = event.key === 'ArrowLeft' ? -18 : 18;
    angleRef.current += step;
    velRef.current = step / 8;
    setAngle(angleRef.current);
  };

  return (
    <div
      ref={rootRef}
      className={`pd-spin ${dragging ? 'dragging' : ''} ${fullscreen ? 'is-fs' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="img"
      aria-label="360 degree view. Drag or use arrow keys to rotate the silk."
    >
      <div className="pd-spin-stage">
        <div
          className="pd-spin-orbit"
          style={{ transform: `rotateY(${angle}deg)` }}
        >
          <div className="pd-spin-face pd-spin-front">
            <ProductVisual product={product} className={`detail-visual ${className}`} imageUrl={currentImage} />
          </div>
          <div className="pd-spin-face pd-spin-back" aria-hidden="true">
            <ProductVisual product={product} className={`detail-visual ${className}`} imageUrl={currentImage} />
          </div>
          <span className="pd-spin-edge" aria-hidden="true" />
        </div>
        <div className="pd-spin-plinth" aria-hidden="true" />
      </div>

      <span className="pd-spin-badge"><RotateCw size={13} /> 360°</span>
      {hint && (
        <span className="pd-spin-hint">
          <RotateCw size={15} /> Drag to orbit
        </span>
      )}
      <button
        type="button"
        className="pd-spin-fs"
        onClick={(event) => {
          event.stopPropagation();
          void toggleFullscreen();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={fullscreen ? 'Exit fullscreen 360 view' : 'Open fullscreen 360 view'}
      >
        {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      {images.length > 1 && (
        <span className="pd-spin-dots" aria-hidden="true">
          {images.map((value, i) => (
            <i
              key={`${value}-${i}`}
              className={i === index ? 'on' : ''}
              onClick={(event) => {
                event.stopPropagation();
                onIndexChange(i);
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
