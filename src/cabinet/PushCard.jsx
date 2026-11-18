import { useEffect, useState } from 'react';
import { disablePush, enablePush, isIos, isStandalone, pushState, pushSupported } from '../lib/push.js';
import { Button, Card, Icon, Toggle, useToast } from '../ui/index.jsx';

// Ловим системное предложение установить PWA (Chrome, Edge, Android).
let deferredPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
}

export default function PushCard() {
  const toast = useToast();
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt));
  const ios = isIos();
  const installed = isStandalone();

  useEffect(() => {
    pushState().then(setState).catch(() => setState('off'));
    const onPrompt = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const toggle = async (on) => {
    setBusy(true);
    try { setState(on ? await enablePush() : await disablePush()); toast(on ? 'Уведомления включены' : 'Уведомления выключены'); }
    catch (err) { toast.error(err); pushState().then(setState).catch(() => {}); } finally { setBusy(false); }
  };
  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    setCanInstall(false);
  };

  const needsInstall = ios && !installed;
  return <Card title="Уведомления и приложение">
    <div className="stack">
      <div className="setting-row" style={{ paddingTop: 0 }}>
        <div className="setting-text">
          <strong>Push-уведомления</strong>
          <span className="setting-hint">Ответы поддержки, окончание и продление подписки, оплаты — даже когда сайт закрыт.</span>
        </div>
        {state === 'unsupported' || needsInstall
          ? <span className="badge badge-muted">Недоступно</span>
          : state === 'denied' ? <span className="badge badge-danger">Запрещены</span>
            : <Toggle checked={state === 'on'} disabled={busy || state === 'loading'} onChange={toggle} label="" />}
      </div>
      {state === 'denied' && <p className="setting-hint">Уведомления запрещены в браузере. Разрешите их в настройках сайта (значок замка в адресной строке) и обновите страницу.</p>}
      {needsInstall && <div className="hint-box hint-box-info">
        <Icon name="device" />
        <p>На iPhone уведомления работают в приложении: нажмите <b>«Поделиться»</b> → <b>«На экран „Домой“»</b>, откройте Service Portal с экрана и включите уведомления здесь.</p>
      </div>}
      {!pushSupported() && !ios && <p className="setting-hint">Этот браузер не поддерживает push-уведомления. Попробуйте Chrome, Edge, Firefox или Safari.</p>}
      {canInstall && !installed && <div className="row-between">
        <div className="setting-text"><strong>Приложение на рабочий стол</strong><span className="setting-hint">Кабинет откроется в отдельном окне, как приложение.</span></div>
        <Button size="sm" variant="secondary" icon="plus" onClick={install}>Установить</Button>
      </div>}
      {installed && <p className="setting-hint">✓ Service Portal установлен как приложение.</p>}
    </div>
  </Card>;
}
