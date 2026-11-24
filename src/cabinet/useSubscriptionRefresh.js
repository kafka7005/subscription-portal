import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { forgetCheckout, subscriptionChanged } from '../lib/checkoutReturn.js';

// A single active read per home view. Bank returns poll the existing receipt;
// ordinary visits only refresh on resume or while the cabinet is visible.
export default function useSubscriptionRefresh(owner, checkout, reloadKeys, reloadSummary) {
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const reference = checkout?.reference;

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    let timer, busy = false, tries = 0, finished = false, paid = false;
    setNotice(reference ? 'Проверяем оплату подписки…' : '');

    const schedule = delay => {
      clearTimeout(timer);
      if (!controller.signal.aborted && !document.hidden) timer = setTimeout(read, delay);
    };
    const refresh = () => Promise.all([reloadKeys(true), reloadSummary(true)]);
    async function read() {
      if (busy || document.hidden || controller.signal.aborted) return;
      busy = true;
      clearTimeout(timer);
      try {
        if (!reference || finished) {
          await refresh();
          return;
        }
        tries += 1;
        const { state } = paid ? { state: 'paid' } : await api.get('/portal/checkout/' + reference, null, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (state === 'declined') {
          finished = true;
          setNotice('Платёж отклонён. Результат можно посмотреть в разделе «Платежи».');
        } else if (state === 'paid' || state === 'completed') {
          paid = true;
          const [keys] = await refresh();
          if (controller.signal.aborted) return;
          finished = subscriptionChanged(checkout.baseline, keys) || (!checkout.baseline && Array.isArray(keys) && tries >= 3);
          setNotice(finished ? 'Оплата подтверждена. Список подписок обновлён.' :
            'Оплата подтверждена. Ожидаем обновления подписки.');
        } else {
          setNotice(state === 'payment_created' || state === 'processing' ?
            'Ожидаем подтверждения оплаты от кассы.' : 'Результат оплаты пока не подтверждён. Его можно проверить в разделе «Платежи».');
        }
        if (finished) forgetCheckout(owner, reference);
      } catch {
        if (!controller.signal.aborted) setNotice('Не удалось проверить статус. Повторим проверку при возвращении в кабинет.');
      } finally {
        busy = false;
        if (!reference || finished) schedule(30_000);
        else if (tries < 7) schedule(Math.min(2_000 * 2 ** (tries - 1), 30_000));
      }
    }
    function resume() {
      if (document.hidden) { clearTimeout(timer); return; }
      tries = 0;
      schedule(120);
    }
    if (reference) void read();
    else schedule(30_000);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [owner, checkout, reloadKeys, reloadSummary, reference, retry]);

  return { notice, check: () => setRetry(value => value + 1) };
}
