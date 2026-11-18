import { useParams } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Icon } from '../ui/index.jsx';
import PublicCabinetShell from '../ui/PublicCabinetShell.jsx';

// Сюда касса возвращает пользователя после оплаты. Само зачисление делает бот
// по вебхуку кассы, поэтому страница только подсказывает следующий шаг.
export default function PaymentResult() {
  const { result } = useParams();
  const ok = result === 'success';
  useDocumentTitle(ok ? 'Оплата прошла' : 'Оплата не прошла');
  return <PublicCabinetShell className="payment-result-page" contentClassName="service-centered">
      <div className="auth-card card card-padded result-card">
        <span className={`result-icon ${ok ? 'ok' : 'fail'}`}><Icon name={ok ? 'check' : 'x'} size={30} strokeWidth={2.4} /></span>
        <h1 className="auth-title">{ok ? 'Оплата прошла' : 'Оплата не прошла'}</h1>
        <p className="muted">{ok
          ? 'Подписка активируется в течение минуты. Если её нет в кабинете дольше 10 минут — напишите в поддержку.'
          : 'Деньги не списаны. Попробуйте ещё раз или выберите другой способ оплаты.'}</p>
        <Button size="lg" className="btn-block" to={ok ? '/cabinet' : '/cabinet/buy'}>{ok ? 'Перейти в кабинет' : 'Попробовать снова'}</Button>
        {!ok && <Button variant="ghost" className="btn-block" to="/cabinet/support">Написать в поддержку</Button>}
      </div>
  </PublicCabinetShell>;
}
