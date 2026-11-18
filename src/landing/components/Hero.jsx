export default function Hero({ copy, onOpen }) {
  return <section className="graphite-hero" aria-labelledby="hero-title">

    <div className="graphite-hero-inner"><div className="graphite-hero-copy">
      <h1 id="hero-title"><span className="hero-line"><b>{copy.slogan[0]}</b></span>{' '}<span className="hero-line"><b>{copy.slogan[1]}</b></span></h1>
      <p>{copy.heroNote}</p>
      <div className="hero-buttons">
        <a href="#plans" className="primary-button">{copy.choose}</a>
        <button type="button" className="account-link" onClick={() => onOpen({ type: 'account' })}>{copy.account}</button>
      </div>
    </div></div>
  </section>;
}
