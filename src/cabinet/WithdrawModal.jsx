import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { rub } from '../lib/format.js';
import { Button, ErrorBox, Input, Modal, Select, Spinner, useToast } from '../ui/index.jsx';

export default function WithdrawModal({ balance, conditions, transfer, method, onMethodSaved, onDone, onClose }) {
  const [destination, setDestination] = useState(null);
  const [amount, setAmount] = useState(String(balance));
  const {me} = useAuth();
  const storageKey = 'partner-transfer:'+me.id;
  const [saved] = useState(() => { try {return localStorage.getItem(storageKey);} catch {return null;} });
  const [uncertain,setUncertain] = useState(Boolean(saved));
  const [requestId] = useState(() => saved || crypto.randomUUID());
  function remember(active) {
    try {
      if (active) localStorage.setItem(storageKey,requestId);
      else localStorage.removeItem(storageKey);
    } catch { /* The current dialog still retains the reference. */ }
  }
  const [busy, setBusy] = useState(false);
  const [methodKey, setMethodKey] = useState(method.data?.method || method.data?.methods?.[0]?.key || '');
  const [requisites, setRequisites] = useState('');
  const toast = useToast();
  const internal = destination === 'balance';
  const cfg = internal ? transfer.data : conditions.data;
  const minimum = Number(internal ? cfg?.min_amount_rub || 0 : cfg?.min_payout_rub || 0);
  const custom = cfg?.custom_amount_enabled === true;
  const value = custom ? Number(amount.replace(',', '.')) : balance;
  const externalAvailable = Boolean(conditions.data && method.data?.methods?.length);
  const available = internal ? transfer.data?.enabled === true : externalAvailable;
  const selectedMethod = methodKey || method.data?.methods?.[0]?.key;
  const needsRequisites = destination === 'external' && (!method.data?.configured || selectedMethod !== method.data?.method);

  const saveRequisites = async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      const data = await api.put('/partners/payout-method/me', { method: selectedMethod, requisites: requisites.trim() });
      onMethodSaved(data); toast('Реквизиты сохранены');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (uncertain || busy || !available || !Number.isFinite(value) || value <= 0 || value < minimum || value > balance) return;
    setBusy(true);
    try {
      if (internal) remember(true);
      const result = internal
        ? await api.post('/portal/partner-transfer', { amount_rub: value, request_id: requestId })
        : await api.post('/partners/payouts/me', { amount_rub: value });
      if (internal) remember(false);
      toast(result.message || 'Заявка отправлена'); onDone(); onClose();
    } catch (err) {
      if (internal && (!err.status || err.status >= 500 || err.status === 409)) setUncertain(true);
      else if (internal) remember(false);
      toast.error(err); onDone();
    } finally { setBusy(false); }
  };

  return <Modal open onClose={() => { if (!busy) onClose(); }} title={!destination ? 'Куда вывести средства?' : needsRequisites ? 'Реквизиты для вывода' : 'Сумма вывода'} size="sm">
    <div className="stack">
      <p className="muted">Партнёрский баланс: {rub(balance)}</p>
      {uncertain ? <><p>Результат перевода требует проверки.</p><Button busy={busy} onClick={async () => {
        setBusy(true);
        try {
          const result = await api.get('/portal/partner-transfer/'+requestId);
          if (result.state === 'done') { remember(false); toast(result.message); onDone(); onClose(); }
          else if (result.state === 'not_found') { setUncertain(false); setDestination('balance'); toast('Операция не зарегистрирована. Номер для повтора сохранён.'); }
          else toast('Подтверждение пока не найдено. Проверьте историю баланса.');
        } catch (err) { toast.error(err); } finally { setBusy(false); }
      }}>Проверить статус</Button></> : !destination ? <>
        {(transfer.loading || conditions.loading || method.loading) && <Spinner />}
        {transfer.data?.enabled && <button type="button" className="withdraw-choice" onClick={() => setDestination('balance')}>
          <strong>На баланс бота</strong><span>Для оплаты подписок{transfer.data.min_amount_rub > 0 ? ` · от ${rub(transfer.data.min_amount_rub)}` : ''}</span>
        </button>}
        {externalAvailable && method.data.methods.map((option) => <button type="button" key={option.key} className="withdraw-choice" onClick={() => { setMethodKey(option.key); setDestination('external'); }}>
          <strong>{option.label}</strong><span>{method.data?.configured && method.data.method === option.key ? method.data.masked : 'Укажите реквизиты'}{conditions.data?.min_payout_rub ? ` · от ${rub(conditions.data.min_payout_rub)}` : ''}</span>
        </button>)}
        {transfer.error && <ErrorBox error={transfer.error} onRetry={transfer.reload} />}
        {conditions.error && <ErrorBox error={conditions.error} onRetry={conditions.reload} />}
        {method.error && <ErrorBox error={method.error} onRetry={method.reload} />}
        {!transfer.loading && !conditions.loading && !method.loading && !transfer.data?.enabled && !externalAvailable && <p className="muted">Нет доступных способов вывода.</p>}
      </> : <>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDestination(null)}>Назад к выбору</Button>
        {needsRequisites ? <form className="stack" onSubmit={saveRequisites}>
          <Select label="Способ" disabled={busy} value={methodKey || method.data?.methods?.[0]?.key || ''} onChange={(e) => setMethodKey(e.target.value)} options={(method.data?.methods || []).map((m) => ({ value: m.key, label: m.label }))} />
          <Input label="Реквизиты" required disabled={busy} value={requisites} onChange={(e) => setRequisites(e.target.value)} hint={method.data?.methods?.find((m) => m.key === methodKey)?.hint} />
          <Button type="submit" busy={busy} disabled={!requisites.trim()}>Далее — сумма</Button>
        </form> : <form className="stack" onSubmit={submit}>
          <p>{internal ? 'На баланс бота — для оплаты подписок.' : `На реквизиты: ${method.data?.method_label || ''} ${method.data?.masked || ''}. Заявку проверит администратор.`}</p>
          <Input label="Сумма, ₽" type="number" step="0.01" min={minimum || 0.01} max={balance} readOnly={!custom} disabled={busy} value={custom ? amount : balance} onChange={(e) => setAmount(e.target.value)} />
          {!custom && <p className="help-text">По настройкам бота доступен только вывод всей суммы.</p>}
          {minimum > 0 && <p className="help-text">Минимум {rub(minimum)}</p>}
          <Button type="submit" busy={busy} disabled={!available || !Number.isFinite(value) || value <= 0 || value < minimum || value > balance}>{internal ? 'Перевести' : 'Отправить заявку'} · {rub(value || 0)}</Button>
        </form>}
      </>}
    </div>
  </Modal>;
}
