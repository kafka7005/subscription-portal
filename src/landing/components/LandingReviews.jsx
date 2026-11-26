import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/hooks.js';
import { reviewApi } from '../../lib/reviews.js';

function ControlIcon({ kind }) {
  return <svg viewBox="0,0,24,24" width="20" height="20" aria-hidden="true" focusable="false">
    {kind === 'play' ? <polygon fill="currentColor" stroke="currentColor" strokeLinejoin="round" points="7,4.5 19.5,12 7,19.5" />
      : kind === 'pause' ? <g fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></g>
      : <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={kind === 'prev' ? 'M19,12 H5 M11,6 L5,12 L11,18' : 'M5,12 H19 M13,6 L19,12 L13,18'} />}
  </svg>;
}

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
      {many && <div className="lr-controls" role="group" aria-label={en ? 'Review controls' : 'Управление отзывами'}>
        <button type="button" aria-label={en ? 'Previous review' : 'Предыдущий отзыв'} onClick={() => select(current - 1)}><ControlIcon kind="prev" /></button>
        <button className="lr-playback" type="button" aria-label={paused ? (en ? 'Play' : 'Продолжить показ') : (en ? 'Pause' : 'Приостановить показ')} onClick={() => setPaused(p => !p)}><ControlIcon kind={paused ? 'play' : 'pause'} /></button>
        <button type="button" aria-label={en ? 'Next review' : 'Следующий отзыв'} onClick={() => select(current + 1)}><ControlIcon kind="next" /></button>
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
