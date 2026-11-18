import { loadFaq } from '../lib/siteSettings.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, PageHead, Spinner } from '../ui/index.jsx';
import PublicCabinetShell from '../ui/PublicCabinetShell.jsx';
import { FaqContent } from './HelpContent.jsx';

function FaqBody({ inCabinet }) {
  const { isStaff } = useAuth();
  const faq = useLoad((signal) => loadFaq(signal), []);
  return <>
    <PageHead title="Частые вопросы" subtitle="Подписка, устройства и подключение. Не нашли ответ — напишите в поддержку."
      actions={isStaff ? <Button variant="ghost" size="sm" icon="settings" to="/admin/site?tab=faq">Редактировать</Button> : null} />
    {faq.loading ? <Spinner /> : <FaqContent faq={faq.data} />}
    <div className="faq-foot card card-padded">
      <div className="cell-main"><strong>Остались вопросы?</strong><span className="muted">Поддержка отвечает в чате кабинета и в Telegram.</span></div>
      <Button variant="secondary" icon="chat" to={inCabinet ? '/cabinet/support' : '/login?next=/cabinet/support'}>В поддержку</Button>
    </div>
  </>;
}

export function PublicFaq() { useDocumentTitle('Частые вопросы'); return <PublicCabinetShell><div className="cabinet-faq"><FaqBody /></div></PublicCabinetShell>; }
export function CabinetFaq() { useDocumentTitle('Частые вопросы'); return <div className="cabinet-faq"><FaqBody inCabinet /></div>; }
