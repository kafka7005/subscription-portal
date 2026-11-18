import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Icon, Input, Modal, useToast } from '../ui/index.jsx';

// Привязка почты кодом. reminder — вариант-напоминание для тех, у кого почты нет.
export default function LinkEmailModal({ open, onClose, reminder = false }) {
  const toast = useToast();
  const { setMe } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSent(false); setCode(''); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (!sent) { await api.post('/auth/link-email/send-code', { email: email.trim() }); setSent(true); }
      else { const me = await api.post('/auth/link-email/confirm', { email: email.trim(), code: code.trim() }); setMe(me); toast('Почта привязана'); onClose(true); }
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return <Modal open={open} onClose={() => onClose(false)} title={reminder ? 'Привяжите почту' : 'Привязать почту'} size="sm">
    <form className="stack" onSubmit={submit}>
      {reminder && <div className="hint-box"><Icon name="mail" /><p>Если потеряете доступ к Telegram, по почте можно будет войти и сохранить подписки. Это займёт минуту.</p></div>}
      {!reminder && <p className="muted">По почте можно входить на сайт и восстанавливать доступ без Telegram.</p>}
      <Input label="Почта" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} placeholder="you@example.com" />
      {sent && <Input label="Код из письма" required value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus hint={`Отправили на ${email.trim()}`} />}
      <Button type="submit" busy={busy} className="btn-block">{sent ? 'Подтвердить' : 'Получить код'}</Button>
      {reminder && <button type="button" className="btn btn-link auth-link" onClick={() => onClose(false)}>Напомнить позже</button>}
    </form>
  </Modal>;
}
