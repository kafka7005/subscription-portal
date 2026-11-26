import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from '../ui/icons.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { reviewApi } from '../lib/reviews.js';
import { Button, ErrorBox, Input, Modal, Textarea, useToast } from '../ui/index.jsx';

function ReviewForm({ initialName, onSaved, onCancel, reload }) {
  const [author, setAuthor] = useState(initialName);
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (!rating || !consent || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.put(reviewApi + '/mine', { author, body, rating, consent }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <form className="stack review-form" onSubmit={submit}>
    <Input label="Имя для публикации" hint={initialName ? "Имя из аккаунта. Можно указать псевдоним." : "Введите имя или псевдоним для публикации."} maxLength={40} required value={author} onChange={e => setAuthor(e.target.value)} />
    <fieldset className="review-rating"><legend>Ваша оценка</legend>
      {[1,2,3,4,5].map(n => <label key={n}>
        <input type="radio" name="review-rating" required checked={rating === n} onChange={() => setRating(n)} aria-label={n + ' из 5'} />
        <span aria-hidden="true" data-filled={n <= rating}>★</span>
      </label>)}
    </fieldset>
    <Textarea label="Ваш отзыв" hint={body.length + ' / 400'} rows={4} minLength={5} maxLength={400} required value={body} onChange={e => setBody(e.target.value)} />
    <label className="review-consent"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /> Разрешаю опубликовать на сайте указанные имя, оценку и текст.</label>
    {error && <ErrorBox error={error} onRetry={error.status === 409 ? reload : undefined} />}
    <div className="row"><Button busy={busy} type="submit" disabled={!consent || !rating || !author.trim() || body.trim().length < 5}>На модерацию</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button></div>
  </form>;
}

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

export default function CustomerReview({ home = false, owner, active = false }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState(false);
  const { data, error, reload, setData } = useLoad(signal => api.get(reviewApi + '/mine', {}, { signal }), [me?.id]);
  const toast = useToast();
  useEffect(() => {
    if (!home || !owner || !active || !data || data.review || data.awarded_rub || error) return;
    try {
      const key = 'review-invitation:' + owner;
      const now = Date.now();
      if (now - Number(localStorage.getItem(key) || 0) < TWO_WEEKS) return;
      localStorage.setItem(key, String(now));
      setInvited(true);
    } catch { /* The permanent review button also works without storage. */ }
  }, [home, owner, active, data, error]);
  if (error?.status === 404 || (!data && !error)) return null;
  const review = data?.review;
  if (error) return <ErrorBox error={error} onRetry={() => reload()} />;
  const name = [me?.display_name, me?.first_name].map(value => typeof value === 'string' ? value.trim() : '')
    .find(value => value && !value.includes('@') && value !== String(me?.tg_id) && value !== me?.email) || '';
  const reward = data.awarded_rub > 0 ? `За отзыв начислено ${data.awarded_rub} ₽.`
    : !review && data.reward_rub > 0 ? `За одобренный отзыв любой оценки — ${data.reward_rub} ₽.` : '';
  return <>
    <section className="home-review-entry" aria-label="Отзывы">
      <div className="review-entry-heading">
        <span className="review-entry-icon"><Icon name={review ? 'check' : 'chat'} size={18} /></span>
        <strong>{review ? 'Спасибо за отзыв!' : invited ? 'Как вам сервис?' : 'Ваш отзыв'}</strong>
      </div>
      {review?.status === 'pending' && <small>Отзыв на модерации.</small>}
      {invited && !review && <small>Что удобно, а что стоит улучшить?</small>}
      {reward && <small>{reward}</small>}
      {!review && <div className="row"><Button variant="secondary" onClick={() => { setInvited(false); setOpen(true); }}>Оставить отзыв</Button>
        {invited && <Button variant="ghost" size="sm" onClick={() => setInvited(false)}>Позже</Button>}</div>}
    </section>
    <Modal open={open && !review} onClose={() => setOpen(false)} title="Оставить отзыв">
      <ReviewForm initialName={Array.from(name).slice(0, 40).join('')} onCancel={() => setOpen(false)}
        reload={() => reload()} onSaved={value => {
          setData(prev => ({ ...prev, ...value }));
          setOpen(false);
          toast('Отзыв отправлен на модерацию');
        }} />
    </Modal>
  </>;
}
