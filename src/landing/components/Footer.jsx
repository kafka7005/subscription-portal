import Brand from './Brand.jsx';
import DocsMenu from '../../ui/DocsMenu.jsx';
export default function Footer({ copy, onOpen }) {
  const copyrightAt = copy.copyright.indexOf('©');
  return <footer className="site-footer" id="support">
    <Brand className="footer-brand" homeLabel={copy.home} />
    <p className="footer-copyright"><span>{copy.copyright.slice(0, copyrightAt).trim()}</span>{' '}<span>{copy.copyright.slice(copyrightAt)}</span></p>
    <nav className="footer-links" aria-label={copy.footerNavigation}>
      <button type="button" onClick={() => onOpen({ type: 'support' })}>{copy.support}</button>
      <DocsMenu variant="landing" label={copy.documents} />
    </nav>
  </footer>;
}
