import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { ErrorBox, Icon, Modal, Spinner } from '../ui/index.jsx';

function QrContent({ clientId }) {
  const state = useLoad((signal) => api.get(`/keys/${encodeURIComponent(clientId)}/qr`, null, { signal }), [clientId]);
  return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : !state.data ? <Spinner />
    : <div className="subscription-qr-image" role="img" aria-label="QR-код подписки">
      <div className="subscription-qr-code" style={{ '--qr-mask': `url("${state.data.image_data_url}")` }} />
      <img className="subscription-qr-fallback" src={state.data.image_data_url} alt="" width="320" height="320" />
    </div>;
}

export default function SubscriptionQr({ clientId, enabled }) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return <><button type="button" className="icon-btn subscription-qr-button" aria-label="QR-код подписки" title="QR-код подписки" onClick={() => setOpen(true)}><Icon name="qr" size={22} /></button>
    <Modal open={open} onClose={() => setOpen(false)} title="QR-код подписки" size="sm"><div className="subscription-qr-stage">{open && <QrContent clientId={clientId} />}</div></Modal></>;
}
