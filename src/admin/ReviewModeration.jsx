import ModuleCompatibility from './ModuleCompatibility.jsx';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { reviewApi, reviewStatus } from '../lib/reviews.js';
import { Button, Card, ErrorBox, Segmented, Spinner, Toggle, useConfirm, useToast } from '../ui/index.jsx';

function RewardEditor({ amount, busy, save }) {
  const [value, setValue] = useState(String(amount));
  return <form className="stack" onSubmit={e => { e.preventDefault(); save(Number(value)); }}>
    <label className="stack">Награда за одобренный отзыв, ₽
      <input className="input" type="number" min="0" max="10000" step="1" required value={value} onChange={e => setValue(e.target.value)} /></label>
    <small className="muted">0 ₽ отключает награду. При одобрении сумма один раз поступит на баланс клиента, независимо от оценки.</small>
    <div><Button type="submit" variant="secondary" disabled={busy || !value || Number(value) === amount}>Сохранить сумму</Button></div>
  </form>;
}

export default function ReviewModeration() {
  const location = useLocation();
  return <ReviewQueue key={location.key} />;
}

function ReviewQueue() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useLoad(
    signal => api.get(reviewApi + '/admin', { status, offset: page * 20 }, { signal }), [status, page]);
  async function remove(item) {
    const ok = await confirm({ title: 'Удалить отзыв навсегда?', text: 'Текст исчезнет с сайта и из очереди модерации. Вернуть его будет невозможно. Уже начисленная награда сохранится.', confirmText: 'Удалить навсегда', danger: true });
    if (ok) await change(item.id, { revision: item.revision }, 'Отзыв удалён', true);
  }
  async function change(path, payload, message, deleting = false) {
    setBusy(true);
    try {
      const url = reviewApi + '/admin/' + path;
      const result = deleting ? await api.del(url, { query: payload }) : await api.put(url, payload);
      toast(result?.awarded_rub ? message + ` · начислено ${result.awarded_rub} ₽` : message);
      if (!['visibility', 'reward'].includes(path) && data.items.length === 1 && page) setPage(page - 1);
      else await reload();
    } catch (err) { toast.error(err); if (err.status === 409) await reload(); }
    finally { setBusy(false); }
  }
  if (error?.status === 404) return <Card title="Отзывы"><ModuleCompatibility requirements={[{ label: "Модерация отзывов", minimum: "1.8.0", missing: true }]} /></Card>;
  if (error) return <ErrorBox error={error} onRetry={() => reload()} />;
  if (!data) return <Spinner />;
  return <div className="stack"><Card title="Отзывы на лендинге"><div className="stack">
    <Toggle label="Показывать одобренные отзывы" checked={data.enabled} disabled={busy || loading}
      onChange={enabled => change('visibility', { enabled }, enabled ? 'Показ включён' : 'Показ выключен')} />
    <p className="muted">Когда показ выключен, клиенты по-прежнему могут оставить отзыв на главной странице кабинета и в профиле.</p>
    {Number.isInteger(data.reward_rub) && <RewardEditor key={data.reward_rub} amount={data.reward_rub} busy={busy || loading}
      save={reward_rub => change('reward', { reward_rub }, 'Награда сохранена')} />}
  </div></Card>
  <ModuleCompatibility requirements={[
    { label: 'Награда за отзыв', minimum: '1.9.0', missing: !Number.isInteger(data.reward_rub) },
    { label: 'Удаление отзывов', minimum: '1.9.1', missing: !data.can_delete },
    { label: 'Уведомления о новых отзывах', minimum: '1.9.2' },
  ]} />
  <Card title="Модерация"><div className="stack">
    <Segmented label="Статус отзыва" value={status} options={Object.entries(reviewStatus).map(([value,label]) => ({ value, label }))}
      onChange={value => { if (!busy) { setStatus(value); setPage(0); } }} />
    {loading ? <Spinner /> : data.items.length ? data.items.map(item => <article className="moderation-review" key={item.id}>
      <div className="row-between"><strong>{item.author}</strong><span>{item.rating} / 5</span></div>
      <p className="review-body">{item.body}</p>
      <div className="row">{['approved','hidden'].filter(s => s !== item.status).map(s =>
        <Button size="sm" key={s} disabled={busy} variant={s === 'approved' ? 'primary' : 'secondary'}
          onClick={() => change(item.id, { status: s, revision: item.revision }, s === 'approved' ? 'Отзыв одобрен' : 'Отзыв скрыт')}>
          {s === 'approved' ? 'Одобрить' : 'Скрыть'}</Button>)}
        {data.can_delete && <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(item)}>Удалить</Button>}</div>
    </article>) : <p className="muted">Здесь пока нет отзывов.</p>}
    {(page > 0 || data.has_more) && <div className="row"><Button variant="secondary" disabled={!page || busy || loading} onClick={() => setPage(page - 1)}>Назад</Button>
      <span>{page + 1}</span><Button variant="secondary" disabled={!data.has_more || busy || loading} onClick={() => setPage(page + 1)}>Далее</Button></div>}
  </div></Card></div>;
}
