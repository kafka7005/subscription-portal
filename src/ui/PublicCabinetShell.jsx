import { useAuth } from '../lib/auth.jsx';
import { useApplyCabinetTheme, useCabinetTheme } from '../lib/theme.js';
import { Button, Icon } from './index.jsx';
import { AppBrand } from './shell.jsx';

// Cabinet-related public screens use the same theme without the account sidebar.
export default function PublicCabinetShell({ children, className = '', contentClassName = '' }) {
  const { me } = useAuth();
  const theme = useCabinetTheme();
  useApplyCabinetTheme(theme.light);
  return <div className={`app theme-cabinet service-page ${className}`}>
    <header className="service-header">
      <AppBrand to="/" />
      <div className="service-header-actions">
        <button type="button" className="icon-btn" onClick={theme.toggle} aria-label={theme.light ? 'Тёмная тема' : 'Светлая тема'}><Icon name={theme.light ? 'moon' : 'sun'} size={20} /></button>
        <Button variant="ghost" size="sm" to={me ? '/cabinet' : '/login'}>{me ? 'В кабинет' : 'Войти'}</Button>
      </div>
    </header>
    <main className={`service-main ${contentClassName}`}>{children}</main>
    <footer className="service-footer"><span>Service Portal</span><nav aria-label="Помощь и документы"><a href="/faq">Частые вопросы</a><a href="/docs">Правовые документы</a></nav></footer>
  </div>;
}
