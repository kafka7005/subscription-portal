import { Modal } from '../ui/index.jsx';
import { DownloadsContent } from '../pages/HelpContent.jsx';

// Окно «Скачать»: открывается из бокового меню, шапки (на телефоне) или по ?download=1.
export default function DownloadModal({ open, onClose, downloads }) {
  return <Modal open={open} onClose={onClose} title="Скачать" size="download">
    <p className="muted dl-sub">Выберите свою платформу. После установки войдите через кабинет — подписка подтянется сама.</p>
    <DownloadsContent downloads={downloads} />
  </Modal>;
}
