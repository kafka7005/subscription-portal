import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, rub } from '../lib/format.js';
import { Button, ErrorBox, KeyValue, Modal, Textarea, useToast } from '../ui/index.jsx';

const LABELS = { balance:'Баланс', tariff_name:'Тариф', devices:'Устройства', traffic_gb:'Трафик, ГБ', expiry_time:'Срок до' };
function value(key, x) {
  if (x == null) return 'Не указан';
  if (key === 'balance') return rub(x);
  if (key === 'expiry_time') return dateTime(x);
  if (key === 'devices' || key === 'traffic_gb') return Number(x) === 0 ? 'Без ограничений' : x;
  return x;
}

export default function ConfirmedOperation({ kind, target, payload, onClose, onDone }) {
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const path = `/portal/admin-operations/${kind}/${encodeURIComponent(target)}`;
  const serialized = JSON.stringify(payload);
  const load = async () => { setError(null); setPreview(null); try { setPreview(await api.post(path, {...JSON.parse(serialized),preview:true})); } catch(err) {setError(err);} };
  useEffect(() => { load(); }, [path, serialized]); // payload stays fixed while this dialog is open
  const submit = async () => {
    if (!preview || !reason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(path, {...payload, preview:false, expected:preview.expected, reason:reason.trim(), request_id:requestId});
      toast('Изменения применены'); onDone(); onClose();
    } catch(err) { setError(err); if(err.status===409)setPreview(null); }
    finally {setBusy(false);}
  };
  return <Modal open title="Проверить изменения" onClose={()=>{if(!busy)onClose();}} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Отмена</Button><Button busy={busy} disabled={!preview || !reason.trim()} onClick={submit}>Подтвердить изменения</Button></>}>
    <div className="stack">
      {error && <ErrorBox error={error} onRetry={!busy ? load : undefined} />}
      {!preview && !error && <p className="muted" role="status">Получаем актуальные данные…</p>}
      {preview && <KeyValue items={Object.keys(LABELS).filter(key=>key in preview.before || key in preview.after).map(key=>[LABELS[key],<span key={key}>{value(key,preview.before[key])} → <strong>{value(key,preview.after[key])}</strong></span>])} />}
      <Textarea label="Причина изменения" required maxLength={500} rows={3} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} hint="Сохранится в журнале администраторов вместе с прежними и новыми значениями." />
      {kind==='tariff' && <p className="field-hint">Административная смена тарифа меняет лимиты. Срок остаётся прежним, оплата с клиента не списывается.</p>}
    </div>
  </Modal>;
}
