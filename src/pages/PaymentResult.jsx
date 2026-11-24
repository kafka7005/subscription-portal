import { checkoutReference } from '../lib/checkoutReturn.js';
import { useParams, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Icon } from '../ui/index.jsx';
import PublicCabinetShell from '../ui/PublicCabinetShell.jsx';

// Сюда касса возвращает пользователя после оплаты. Само зачисление делает бот
// по вебхуку кассы, поэтому страница только подсказывает следующий шаг.
export default function PaymentResult() {
  const { result } = useParams();
  const ok = result === 'success';
  const [params] = useSearchParams();
  const reference = checkoutReference(params.get('checkout'));
  const cabinet = reference ? '/cabinet?checkout=' + reference : '/cabinet';
  useDocumentTitle('Результат оплаты');
  return <PublicCabinetShell className="payment-result-page" contentClassName="service-centered">
      <div className="auth-card card card-padded result-card">
        <span className={`result-icon ${ok ? 'ok' : 'fail'}`}><Icon name={ok ? 'check' : 'x'} size={30} strokeWidth={2.4} /></span>
        <h1 className="auth-title">{ok ? 'Возвращение из кассы' : 'Оплата прервана'}</h1>
        <p className="muted">{ok
          ? 'Откройте кабинет, чтобы посмотреть результат оплаты. Кассе может понадобиться время для подтверждения.'
          : 'Перед повторной оплатой проверьте статус предыдущей попытки в кабинете.'}</p>
        <Button size="lg" className="btn-block" to={cabinet}>Перейти в кабинет</Button>
        {!ok && <Button variant="ghost" className="btn-block" to="/cabinet/support">Написать в поддержку</Button>}
      </div>
  </PublicCabinetShell>;
}
