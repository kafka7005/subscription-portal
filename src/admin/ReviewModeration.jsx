import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { reviewApi, reviewStatus } from '../lib/reviews.js';
import { Button, Card, ErrorBox, Segmented, Spinner, Toggle, useToast } from '../ui/index.jsx';

export default function ReviewModeration() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(
    signal => api.get(reviewApi + '/admin', { status, offset: page * 20 }, { signal }), [status, page]);
  async function change(path, payload, message) {
    setBusy(true);
    try {
      await api.put(reviewApi + '/admin/' + path, payload);
      toast(message);
      if (path !== 'visibility' && data.items.length === 1 && page) setPage(page - 1);
      else await reload();
    } catch (err) { toast.error(err); if (err.status === 409) await reload(); }
    finally { setBusy(false); }
  }
  if (error?.status === 404) return <Card title="Отзывы"><p>Для модерации установите модуль версии 1.8.0 или новее.</p></Card>;
  if (error) return <ErrorBox error={error} onRetry={() => reload()} />;
  if (!data) return <Spinner />;
  return <div className="stack"><Card title="Отзывы на лендинге"><div className="stack">
    <Toggle label="Показывать одобренные отзывы" checked={data.enabled} disabled={busy || loading}
      onChange={enabled => change('visibility', { enabled }, enabled ? 'Показ включён' : 'Показ выключен')} />
    <p className="muted">Когда показ выключен, клиенты по-прежнему могут оставить отзыв в профиле.</p>
  </div></Card>
  <Card title="Модерация"><div className="stack">
    <Segmented label="Статус отзыва" value={status} options={Object.entries(reviewStatus).map(([value,label]) => ({ value, label }))}
      onChange={value => { if (!busy) { setStatus(value); setPage(0); } }} />
    {loading ? <Spinner /> : data.items.length ? data.items.map(item => <article className="moderation-review" key={item.id}>
      <div className="row-between"><strong>{item.author}</strong><span>{item.rating} / 5</span></div>
      <p className="review-body">{item.body}</p>
      <div className="row">{['approved','hidden'].filter(s => s !== item.status).map(s =>
        <Button size="sm" key={s} disabled={busy} variant={s === 'approved' ? 'primary' : 'secondary'}
          onClick={() => change(item.id, { status: s, revision: item.revision }, s === 'approved' ? 'Отзыв одобрен' : 'Отзыв скрыт')}>
          {s === 'approved' ? 'Одобрить' : 'Скрыть'}</Button>)}</div>
    </article>) : <p className="muted">Здесь пока нет отзывов.</p>}
    {(page > 0 || data.has_more) && <div className="row"><Button variant="secondary" disabled={!page || busy || loading} onClick={() => setPage(page - 1)}>Назад</Button>
      <span>{page + 1}</span><Button variant="secondary" disabled={!data.has_more || busy || loading} onClick={() => setPage(page + 1)}>Далее</Button></div>}
  </div></Card></div>;
}
