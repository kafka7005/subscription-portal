import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { rub, shortDate } from '../lib/format.js';
import { Button, Card, Empty, ErrorBox, IconButton, Input, KeyValue, Modal, Segmented, Spinner, Table, useConfirm, useToast } from '../ui/index.jsx';

// Партнёрка конкретного клиента в его карточке: код, процент, баланс, приглашённые.
// Бот принимает ссылку на клиента как «u<users.id>» (или прежний Telegram ID).
async function call(method, path, query) {
  const res = await (method === 'patch' ? api.patch(path, undefined, { query }) : method === 'post' ? api.post(path, undefined, { query }) : api.del(path));
  if (res && res.success === false) throw new Error(res.message || 'Не удалось сохранить');
  return res;
}

function EditModal({ open, onClose, partner, refId, onDone }) {
  const toast = useToast();
  const [tab, setTab] = useState('percent');
  const [percent, setPercent] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast(msg); onDone(); onClose(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Партнёрка клиента" size="sm">
    <Segmented label="Что изменить" value={tab} onChange={setTab} options={[{ value: 'percent', label: 'Процент' }, { value: 'balance', label: 'Баланс' }, { value: 'code', label: 'Код' }]} />
    {tab === 'percent' && <div className="stack">
      <p className="muted">Сейчас {partner.partner_percent}%. Личный процент заменяет общий из настроек партнёрки.</p>
      <Input label="Процент с оплат" type="number" min="0" max="100" step="0.5" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder={String(partner.partner_percent)} />
      <div className="row">
        <Button busy={busy} disabled={percent === ''} onClick={() => run(() => call('patch', `/partners/${refId}/percent`, { percent: Number(percent) }), 'Процент обновлён')}>Сохранить</Button>
        <Button variant="ghost" busy={busy} onClick={() => run(() => call('patch', `/partners/${refId}/percent/reset`), 'Вернули общий процент')}>Сбросить на общий</Button>
      </div>
    </div>}
    {tab === 'balance' && <div className="stack">
      <p className="muted">Партнёрский баланс сейчас {rub(partner.partner_balance)}. Это деньги для вывода, не баланс в боте.</p>
      <Segmented label="Действие" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Начислить' }, { value: 'subtract', label: 'Списать' }, { value: 'set', label: 'Установить' }]} />
      <Input label="Сумма, ₽" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button busy={busy} disabled={!amount} onClick={() => run(() => call('patch', `/partners/${refId}/balance`, { amount: Number(amount), mode }), 'Баланс обновлён')}>Применить</Button>
    </div>}
    {tab === 'code' && <div className="stack">
      <p className="muted">Код в ссылке: {window.location.host}/partner/<b>{partner.partner_code || 'код'}</b>. Старые ссылки с прежним кодом перестанут работать.</p>
      <Input label="Новый код" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder={partner.partner_code || 'name'} hint="a-z, 0-9 и _, от 3 до 32 символов" />
      <Button busy={busy} disabled={!/^[a-z0-9_]{3,32}$/.test(code)} onClick={() => run(() => call('patch', `/partners/${refId}/code`, { code }), 'Код обновлён')}>Сохранить</Button>
    </div>}
  </Modal>;
}

export default function PartnerAdmin({ user }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const refId = `u${user.id}`;
  const state = useLoad((signal) => api.get(`/partners/${refId}`, null, { signal }), [refId]);
  const [edit, setEdit] = useState(false);
  const [joined, setJoined] = useState('');
  const p = state.data;

  const addInvited = async (e) => {
    e.preventDefault();
    const raw = joined.trim().replace(/^#/, '');
    const ref = /^\d{1,9}$/.test(raw) && raw.length < 7 ? `u${raw}` : raw; // короткое число — users.id, длинное — Telegram ID
    try { await call('post', `/partners/${refId}/invited`, { joined_tg_id: ref }); toast('Клиент закреплён за партнёром'); setJoined(''); state.reload(true); }
    catch (err) { toast.error(err); }
  };
  const removeInvited = async (row) => {
    if (!await confirm({ title: 'Открепить приглашённого?', text: 'Будущие оплаты этого клиента не будут приносить партнёру бонус.', confirmText: 'Открепить', danger: true })) return;
    try { await call('delete', `/partners/${refId}/invited/${row.tg_id || `u${row.user_id}`}`); toast('Откреплён'); state.reload(true); }
    catch (err) { toast.error(err); }
  };

  return <Card title="Партнёрка" actions={p && p.success !== false && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Изменить</Button>}>
    {state.loading && !p ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : !p || p.success === false
      ? <p className="muted">Партнёрский профиль недоступен.</p>
      : <div className="stack">
        <KeyValue items={[
          ['Код', p.partner_code ? <span className="mono">{p.partner_code}</span> : '—'],
          ['Процент', `${p.partner_percent}%`],
          ['Баланс к выводу', rub(p.partner_balance)],
          ['Вывод', p.payout_method || 'не указан'],
          ['Приглашено', p.invited?.length || 0],
        ]} />
        <div className="setting-sub">
          <strong>Приглашённые</strong>
          <Table rows={p.invited || []} rowKey={(r) => r.user_id} onRowClick={(r) => r.user_id && navigate(`/admin/users/${r.user_id}`)}
            empty={<Empty icon="users" title="Пока никого" />}
            columns={[
              { key: 'who', title: 'Клиент', className: 'cell-primary', render: (r) => <div className="cell-main"><strong>#{r.user_id}</strong><span>{r.tg_id ? `TG ${r.tg_id}` : ''}</span></div> },
              { key: 'joined', title: 'С', className: 'nowrap', render: (r) => shortDate(r.joined_at) },
              { key: 'pays', title: 'Оплат', className: 'num', render: (r) => r.payments_count },
              { key: 'x', title: '', className: 'num', render: (r) => <IconButton icon="x" label="Открепить" onClick={(e) => { e.stopPropagation(); removeInvited(r); }} /> },
            ]} />
          <form className="inline-form" onSubmit={addInvited} style={{ marginTop: 10 }}>
            <Input aria-label="ID клиента" placeholder="ID клиента или Telegram ID" value={joined} onChange={(e) => setJoined(e.target.value)} />
            <Button type="submit" size="sm" variant="secondary" disabled={!joined.trim()}>Закрепить</Button>
          </form>
        </div>
      </div>}
    {p && p.success !== false && <EditModal open={edit} onClose={() => setEdit(false)} partner={p} refId={refId} onDone={() => state.reload(true)} />}
  </Card>;
}
