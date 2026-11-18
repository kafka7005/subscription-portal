import { Link, useParams } from 'react-router-dom';
import { docSlug, readKzPage, useSiteSettings } from '../lib/siteSettings.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date } from '../lib/format.js';
import { Markdown } from '../lib/markdown.jsx';
import { Button, ErrorBox, Icon, Spinner } from '../ui/index.jsx';
import DocShell from '../ui/PublicCabinetShell.jsx';

// /docs — все правовые документы списком. Список ведётся в админке → Сайт → Документы,
// поэтому новый документ появляется здесь (и в меню «Документы») без правок сайта.
export function DocsIndex() {
  useDocumentTitle('Правовые документы');
  const site = useSiteSettings();
  return <DocShell>
    <section className="legal-index page-enter">
      <h1 className="docs-index-title">Правовые документы</h1>
      <p className="muted docs-index-sub">Условия использования Service Portal. Последние редакции — на этой странице.</p>
      {!site ? <Spinner /> : <div className="docs-index">
        {site.docs.map((d) => <Link key={d.slug} to={`/docs/${d.slug}`} className="docs-index-item card">
          <span className="docs-index-icon"><Icon name="file" size={20} /></span>
          <span className="docs-index-name">{d.title}</span>
          <Icon name="arrow" size={18} className="docs-index-arrow" />
        </Link>)}
      </div>}
    </section>
  </DocShell>;
}

// Публичная страница документа: /docs/offer, /docs/rules и т. д. Текст задаётся в админке → Сайт.
export default function Doc() {
  const { slug } = useParams();
  const state = useLoad((signal) => (/^[a-z0-9-]{1,48}$/.test(slug) ? readKzPage(docSlug(slug), signal) : null), [slug]);
  const doc = state.data;
  useDocumentTitle(doc?.title || 'Документ');
  return <DocShell>
    <article className="legal-document page-enter">
      <Link to="/docs" className="back-link docs-back"><Icon name="back" size={16} />Все документы</Link>
      {state.loading ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : !doc ? <div className="stack">
        <h1>Документ не найден</h1>
        <p className="muted">Возможно, его ещё не опубликовали.</p>
        <Button to="/docs" className="self-start">Все документы</Button>
      </div> : <>
        <h1>{doc.title}</h1>
        {doc.updated_at && <p className="muted" style={{ margin: '8px 0 24px' }}>Редакция от {date(doc.updated_at)}</p>}
        <div className="doc-body"><Markdown text={doc.body} /></div>
      </>}
    </article>
  </DocShell>;
}
