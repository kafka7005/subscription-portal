import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { reviewApi } from '../../lib/reviews.js';

function ReviewShowcase({ items, en }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [reading, setReading] = useState(false);
  const rail = useRef(null);
  const group = useRef(null);
  const many = items.length > 1;
  const active = items[current];

  function select(i) {
    setCurrent((i + items.length) % items.length);
    setPaused(true);
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPaused(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!many || paused || reading) return;
    const node = rail.current;
    let position = node.scrollLeft;
    let length = group.current.offsetWidth;
    let previous = null;
    let elapsed = 0;
    let frame;
    const resize = new ResizeObserver(() => { length = group.current.offsetWidth; });
    resize.observe(group.current);
    function move(now) {
      const delta = previous === null || document.hidden ? 0 : Math.min(now - previous, 80);
      previous = now;
      if (length > 0) {
        position = (position + delta * 0.023) % length;
        node.scrollLeft = position;
      }
      elapsed += delta;
      if (elapsed >= 11000) {
        elapsed = 0;
        setCurrent(i => (i + 1) % items.length);
      }
      frame = requestAnimationFrame(move);
    }
    frame = requestAnimationFrame(move);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [many, items.length, paused, reading]);

  return <section className="landing-reviews" aria-labelledby="customer-reviews-title">
    <div className="lr-heading"><h2 id="customer-reviews-title">{en ? 'In their own words' : 'Слово пользователям'}</h2>
      {many && <div className="lr-controls">
        <button type="button" aria-label={en ? 'Previous review' : 'Предыдущий отзыв'} onClick={() => select(current - 1)}>←</button>
        <button type="button" aria-label={paused ? (en ? 'Play' : 'Продолжить показ') : (en ? 'Pause' : 'Приостановить показ')} onClick={() => setPaused(!paused)}>{paused ? '▶' : 'Ⅱ'}</button>
        <button type="button" aria-label={en ? 'Next review' : 'Следующий отзыв'} onClick={() => select(current + 1)}>→</button>
      </div>}
    </div>
    <div onPointerEnter={e => { if (e.pointerType === 'mouse') setReading(true); }} onPointerLeave={() => setReading(false)}>
      <article className="lr-feature" onPointerDown={() => setPaused(true)}>
        <div className="lr-quotes">{items.map((item, i) =>
          <blockquote key={i} aria-hidden={i !== current} data-current={i === current} data-long={item.body.length > 180}>{item.body}</blockquote>)}</div>
        <div className="lr-byline"><strong>{active.author}</strong>
          <span aria-label={active.rating + (en ? ' out of 5' : ' из 5')}>{'★'.repeat(active.rating)}{'☆'.repeat(5 - active.rating)}</span>
        </div>
      </article>
      {many && <div ref={rail} className="lr-rail" onFocus={() => setPaused(true)} onWheel={() => setPaused(true)} onPointerDown={() => setPaused(true)}>
        {[0,1,2].map(copy => <div className="lr-group" key={copy} ref={copy === 0 ? group : undefined} aria-hidden={copy ? true : undefined}>
          {items.map((item,i) => <button type="button" key={i} tabIndex={copy ? -1 : 0} aria-pressed={i === current} onClick={() => select(i)}>
            <strong>{item.author}</strong><span>{item.body}</span>
          </button>)}</div>)}
      </div>}
    </div>
  </section>;
}

export default function LandingReviews({ locale }) {
  const { data } = useLoad(signal => api.get(reviewApi + '/public', {}, { signal }));
  return data?.items?.length ? <ReviewShowcase items={data.items} en={locale === 'en'} /> : null;
}
