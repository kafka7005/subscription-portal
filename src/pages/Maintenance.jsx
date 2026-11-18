import { links } from '../lib/site.js';
import { Button } from '../ui/index.jsx';

export default function Maintenance({ info }) {
  return <div className="app maintenance">
    <div className="card card-padded anim-pop">
      <img src="/icons/logo.svg" alt="" width="96" height="96" />
      <h1>{info?.title || 'Ведём технические работы'}</h1>
      <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{info?.text || 'Скоро вернёмся.'}</p>
      <Button variant="secondary" href={links.support} target="_blank" rel="noopener noreferrer" iconRight="external">Поддержка в Telegram</Button>
    </div>
  </div>;
}
