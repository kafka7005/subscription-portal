import { Component } from 'react';

// Чанк старого релиза не найден (вкладка открыта до выкладки) — новая версия уже на сервере.
const STALE_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;
const RELOAD_KEY = 'portal-chunk-reload';

export function isStaleChunk(error) {
  return STALE_RE.test(String(error?.message || error || ''));
}

// Перезагружает страницу не чаще раза в 30 секунд; возвращает true, если перезагрузка пошла.
export function reloadForStaleChunk(error) {
  if (!isStaleChunk(error)) return false;
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* ignore */ }
  if (Date.now() - last < 30000) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
  window.location.reload();
  return true;
}

// Ловит ошибки отрисовки: вместо пустого чёрного экрана — понятное сообщение.
// Сбрасывается при переходе на другую страницу (resetKey = путь).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    if (reloadForStaleChunk(error)) return;
    console.error('[portal] Ошибка интерфейса', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (isStaleChunk(this.state.error)) return <div className="crash" role="alert">
      <strong>Сайт обновился</strong>
      <p>Вышла новая версия — обновите страницу, чтобы продолжить.</p>
      <div className="row"><button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Обновить</button></div>
    </div>;
    return <div className="crash" role="alert">
      <strong>Что-то пошло не так</strong>
      <p>Эта страница не смогла открыться. Обновите её — если ошибка повторится, напишите в поддержку.</p>
      <code>{String(this.state.error?.message || this.state.error).slice(0, 200)}</code>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Обновить</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.history.back()}>Назад</button>
      </div>
    </div>;
  }
}
