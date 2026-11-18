import { useState } from 'react';
import { Icon } from './icons.jsx';
import countryCodes from '../lib/countryCodes.json';

const available = new Set(countryCodes);
export default function CountryFlag({ code }) {
  const [failedCode, setFailedCode] = useState(null);
  if (!available.has(code) || failedCode === code) return <span className="service-flag service-flag-fallback" aria-hidden="true"><Icon name="globe" size={24}/></span>;
  return <img className="service-flag" src={`/assets/flags/${code.toLowerCase()}.svg`} width="48" height="36" alt="" loading="lazy" decoding="async" onError={() => setFailedCode(code)} />;
}
