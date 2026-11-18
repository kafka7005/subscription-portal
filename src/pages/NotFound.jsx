import { Button } from '../ui/index.jsx';
import { AppBrand } from '../ui/shell.jsx';

export default function NotFound() {
  return <div className="app auth-page">
    <header className="auth-top"><AppBrand to="/" /></header>
    <main className="auth-main">
      <div className="auth-card card card-padded result-card">
        <h1 className="auth-title">Страница не найдена</h1>
        <p className="muted">Возможно, ссылка устарела. Вернитесь на главную или в кабинет.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button to="/">На главную</Button>
          <Button variant="secondary" to="/cabinet">В кабинет</Button>
        </div>
      </div>
    </main>
  </div>;
}
