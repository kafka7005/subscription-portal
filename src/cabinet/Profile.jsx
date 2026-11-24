import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import { date, rub } from '../lib/format.js';
import { startTelegramAuth } from '../lib/telegramAuth.js';
import { Badge, Button, Card, Icon, Input, KeyValue, Loadable, Modal, PageHead, useToast } from '../ui/index.jsx';
import { TelegramIcon } from '../ui/icons.jsx';
import LinkEmailModal from './LinkEmail.jsx';
import PushCard from './PushCard.jsx';
import ThemeCard from './ThemeCard.jsx';
import SessionsCard from './SessionsCard.jsx';
import NotificationPreferences from './NotificationPreferences.jsx';

function PasswordModal({ open, onClose, hasPassword }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (hasPassword) await api.post('/auth/change-password', { current_password: current, password: pw, password_confirm: pw2 });
      else await api.post('/auth/set-password', { password: pw, password_confirm: pw2 });
      toast('Пароль сохранён'); refresh(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title={hasPassword ? 'Сменить пароль' : 'Задать пароль'} size="sm">
    <form className="stack" onSubmit={submit}>
      {hasPassword && <Input label="Текущий пароль" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <Input label="Новый пароль" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} hint="Не короче 8 символов" />
      <Input label="Повторите" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? 'Пароли не совпадают' : null} />
      <Button type="submit" busy={busy} disabled={pw !== pw2} className="btn-block">Сохранить</Button>
    </form>
  </Modal>;
}

function Row({ icon, title, value, ok, children }) {
  return <div className={`link-row ${ok ? 'is-linked' : 'is-missing'}`}>
    <span className="link-icon">{icon}</span>
    <div className="cell-main"><strong>{title}</strong><span>{value}</span></div>
    {children}
  </div>;
}

export default function Profile() {
  useDocumentTitle('Профиль');
  const { me, config, logout } = useAuth();
  const { summary, giveawaysVisible } = useOutletContext();
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const features = config?.features || {};
  const s = summary.data;

  const onLogout = async () => { if (await logout()) navigate('/', { replace: true }); };
  const linkTelegram = () => startTelegramAuth({ mode: 'link', next: '/cabinet/profile' }).catch((err) => toast.error(err));

  return <>
    <PageHead title="Профиль" actions={<Button variant="ghost" icon="logout" onClick={onLogout}>Выйти</Button>} />
    <div className="grid grid-2">
      <Card title="Способы входа">
        <div className="link-list">
          <Row icon={<TelegramIcon size={20} />} title="Telegram" ok={Boolean(me?.tg_id)}
            value={me?.tg_id ? (me.username ? `@${me.username}` : `ID ${me.tg_id}`) : 'Не привязан — подписки из бота не видны'}>
            {me?.tg_id ? <span className="link-state"><Icon name="check" size={16} />Привязан</span>
              : config?.auth?.telegram_login_enabled !== false && <Button size="sm" variant="secondary" onClick={linkTelegram}>Привязать</Button>}
          </Row>
          <Row icon={<Icon name="mail" />} title="Почта" ok={Boolean(me?.email && me.email_verified !== false)}
            value={me?.email ? `${me.email}${me.email_verified === false ? ' · не подтверждена' : ''}` : 'Не привязана'}>
            {me?.email ? <span className="link-state"><Icon name="check" size={16} />Привязана</span>
              : <Button size="sm" variant="secondary" onClick={() => setModal('email')}>Привязать</Button>}
          </Row>
          {me?.email && <Row icon={<Icon name="shield" />} title="Пароль" ok={me.password_set} value={me.password_set ? 'Задан' : 'Не задан — вход по коду из письма'}>
            <Button size="sm" variant="secondary" onClick={() => setModal('password')}>{me.password_set ? 'Сменить' : 'Задать'}</Button>
          </Row>}
        </div>
      </Card>
      <Card title="Аккаунт">
        <KeyValue items={[
          ['Имя', me?.display_name || '—'],
          ['С нами с', date(me?.created_at)],
          s && ['Подписок', s.keys_total],
          ['Баланс', rub(s?.balance)],
          features.partner_enabled && s && ['Партнёрский баланс', rub(s.partner_balance)],
          ['Платежи', <Button variant="link" to="/cabinet/payments" key="p">История оплат</Button>],
        ]} />
      </Card>
    </div>
    <div className="grid grid-2"><ThemeCard /><PushCard /></div>
    {giveawaysVisible && <Button variant="secondary" icon="gift" to="/cabinet/giveaways">Розыгрыши</Button>}
    <NotificationPreferences />
    <SessionsCard />
    <Link to="/docs" className="profile-docs-link"><Icon name="file" size={15} />Правовые документы</Link>
    <LinkEmailModal open={modal === 'email'} onClose={() => setModal(null)} />
    <PasswordModal open={modal === 'password'} onClose={() => setModal(null)} hasPassword={me?.password_set} />
  </>;
}
