import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { reviewApi, reviewStatus } from '../lib/reviews.js';
import { Badge, Button, Card, ErrorBox, Input, Modal, Textarea, useConfirm, useToast } from '../ui/index.jsx';

function ReviewForm({ review, onSaved, onCancel, reload }) {
  const [author, setAuthor] = useState(review?.author || '');
  const [body, setBody] = useState(review?.body || '');
  const [rating, setRating] = useState(review?.rating || 0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (!rating || !consent || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.put(reviewApi + '/mine', { author, body, rating, consent, revision: review?.revision || null }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <form className="stack review-form" onSubmit={submit}>
    <Input label="Имя для публикации" hint="Можно указать псевдоним." maxLength={40} required value={author} onChange={e => setAuthor(e.target.value)} />
    <fieldset className="review-rating"><legend>Ваша оценка</legend>
      {[1,2,3,4,5].map(n => <label key={n}>
        <input type="radio" name="review-rating" required checked={rating === n} onChange={() => setRating(n)} aria-label={n + ' из 5'} />
        <span aria-hidden="true" data-filled={n <= rating}>★</span>
      </label>)}
    </fieldset>
    <Textarea label="Ваш отзыв" hint={body.length + ' / 400'} rows={4} minLength={5} maxLength={400} required value={body} onChange={e => setBody(e.target.value)} />
    <label className="review-consent"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /> Разрешаю опубликовать на сайте указанные имя, оценку и текст.</label>
    {review?.status === 'approved' && <p className="muted">После редактирования отзыв вернётся на модерацию и временно исчезнет с лендинга.</p>}
    {error && <ErrorBox error={error} onRetry={error.status === 409 ? reload : undefined} />}
    <div className="row"><Button busy={busy} type="submit" disabled={!consent || !rating || !author.trim() || body.trim().length < 5}>На модерацию</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button></div>
  </form>;
}

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

export default function CustomerReview({ home = false, owner, active = false }) {
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState(false);
  const { data, error, reload, setData } = useLoad(signal => api.get(reviewApi + '/mine', {}, { signal }));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
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
  async function withdraw() {
    if (!await confirm({ title: 'Удалить отзыв?', text: 'Отзыв будет удалён из кабинета и с лендинга.', confirmText: 'Удалить', danger: true })) return;
    setBusy(true);
    try {
      await api.del(reviewApi + '/mine?revision=' + encodeURIComponent(review.revision));
      setData(prev => ({ ...prev, review: null }));
      setOpen(false);
      toast('Отзыв удалён');
    } catch (err) { toast.error(err); await reload(); } finally { setBusy(false); }
  }
  const reward = data?.awarded_rub > 0 ? `За отзыв начислено ${data.awarded_rub} ₽.`
    : data?.reward_rub > 0 ? `Награда за первый одобренный отзыв — ${data.reward_rub} ₽ при текущих настройках. Подойдёт любая оценка.` : null;
  function close() {
    setOpen(false);
    setEditing(false);
  }
  const content = <>
    {error ? <ErrorBox error={error} onRetry={() => reload()} /> : editing
      ? <ReviewForm key={review?.revision || 'new'} review={review} onCancel={() => { if (home && !review) close(); else setEditing(false); }}
          reload={() => { setEditing(false); reload(); }}
          onSaved={value => { setData(prev => ({ ...prev, ...value })); setInvited(false); close(); toast('Отзыв отправлен на модерацию'); }} />
      : <div className="stack">
        {review ? <><div className="row"><strong>{review.author}</strong><span>{review.rating} / 5</span>
          <Badge tone={review.status === 'approved' ? 'ok' : 'neutral'}>{reviewStatus[review.status]}</Badge></div>
          <p className="review-body">{review.body}</p></> : <p className="muted">Поделитесь впечатлением о сервисе. После проверки ваш отзыв сможет появиться на главной странице.</p>}
        <div className="row"><Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>{review ? 'Редактировать' : 'Оставить отзыв'}</Button>
          {review && <Button variant="ghost" busy={busy} onClick={withdraw}>Удалить</Button>}</div>
      </div>}
  </>;
  if (!home) return <Card title="Мой отзыв">{reward && <p className="muted">{reward}</p>}{content}</Card>;
  return <>
    <section className="home-review-entry" aria-label="Отзывы">
      <div><strong>{invited && !review ? 'Как вам сервис?' : 'Ваш отзыв'}</strong>
        <small>{review ? reviewStatus[review.status] : invited ? 'Расскажите, что удобно и что стоит улучшить.' : 'Поделитесь впечатлениями о подписке.'}</small>
        {reward && <small>{reward}</small>}</div>
      <div className="row"><Button variant="secondary" onClick={() => { setInvited(false); setEditing(!review); setOpen(true); }}>
        {review ? 'Мой отзыв' : 'Оставить отзыв'}</Button>
        {invited && !review && <Button variant="ghost" size="sm" onClick={() => setInvited(false)}>Позже</Button>}</div>
    </section>
    <Modal open={open} onClose={close} title={review ? 'Мой отзыв' : 'Оставить отзыв'}>
      {reward && <p className="muted">{reward}</p>}{content}
    </Modal>
  </>;
}
