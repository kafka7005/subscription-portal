import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

// Capabilities reported by an endpoint take precedence over a version comparison.
export default function ModuleCompatibility({ requirements, fallback }) {
  const { moduleVersion } = useOutletContext() || {};
  const { isAdmin } = useAuth();
  const known = /^\d+\.\d+\.\d+$/.test(moduleVersion || '');
  const unavailable = requirements.filter(({ minimum, missing }) =>
    missing ?? (known && moduleVersion.localeCompare(minimum, 'en', { numeric: true }) < 0));
  if (!unavailable.length) return null;
  return <div className="notice" role="status">
    {unavailable.map(({ label, minimum }) => <div key={label}>{label} — модуль {minimum} или новее.</div>)}
    <div>{known ? `Установлен модуль ${moduleVersion}.` : 'Установленная версия пока неизвестна.'} {fallback}</div>
    {isAdmin && <Link className="btn btn-ghost btn-sm" to="/admin/site?tab=updates">Перейти к обновлениям</Link>}
  </div>;
}
