type WelcomeProps = {
  onCreateAccount: () => void;
  onLogIn: () => void;
};

export default function Welcome({ onCreateAccount, onLogIn }: WelcomeProps) {
  return (
    <main className="lp-welcome">
      <style>{`
        .lp-welcome {
          --lp-gold: #e7bd4b;
          --lp-gold-bright: #f4d36e;
          --lp-ink: #090a0b;
          --lp-muted: #aaa8a0;
          min-height: 100dvh;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          color: #f4f0e7;
          background:
            radial-gradient(ellipse at 76% 48%, rgba(204, 159, 45, .075), transparent 36%),
            radial-gradient(ellipse at 12% 0%, rgba(255, 255, 255, .035), transparent 42%),
            var(--lp-ink);
          padding: max(22px, env(safe-area-inset-top)) clamp(20px, 5vw, 72px) max(22px, env(safe-area-inset-bottom));
          font-family: var(--app-font-sans, 'DM Sans', sans-serif);
        }
        .lp-welcome::before {
          content: "";
          position: absolute;
          z-index: -1;
          inset: 0;
          pointer-events: none;
          opacity: .18;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.92' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
        }
        .lp-welcome__header {
          width: min(100%, 1320px);
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 42px;
          animation: lp-arrive .65s both;
        }
        .lp-welcome__mark {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--lp-gold-bright);
          font: 700 12px var(--app-font-mono, monospace);
          letter-spacing: .14em;
          text-transform: uppercase;
        }
        .lp-welcome__sigil {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          border: 1px solid rgba(231, 189, 75, .62);
          color: var(--lp-gold-bright);
          font: 700 17px var(--display-font, sans-serif);
          transform: rotate(45deg);
        }
        .lp-welcome__sigil span { transform: rotate(-45deg); }
        .lp-welcome__edition {
          color: #77766f;
          font: 10px var(--app-font-mono, monospace);
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .lp-welcome__hero {
          width: min(100%, 1320px);
          flex: 1;
          min-height: 0;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(320px, .84fr) minmax(0, 1.16fr);
          align-items: center;
          gap: clamp(24px, 5vw, 82px);
          padding: clamp(32px, 6vh, 76px) 0 clamp(22px, 5vh, 56px);
        }
        .lp-welcome__copy {
          position: relative;
          z-index: 1;
          max-width: 590px;
          animation: lp-arrive .8s .08s both;
        }
        .lp-welcome__overline {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 24px;
          color: var(--lp-gold);
          font: 700 10px var(--app-font-mono, monospace);
          letter-spacing: .2em;
          text-transform: uppercase;
        }
        .lp-welcome__overline::before {
          content: "";
          width: 34px;
          height: 1px;
          background: var(--lp-gold);
        }
        .lp-welcome h1 {
          margin: 0;
          max-width: 650px;
          color: #f4f0e7;
          font: 800 clamp(49px, 7.8vw, 112px)/.82 var(--display-font, 'Barlow Condensed', sans-serif);
          letter-spacing: -.035em;
          text-transform: uppercase;
        }
        .lp-welcome h1 span { display: block; color: var(--lp-gold-bright); }
        .lp-welcome__tagline {
          margin: 27px 0 0;
          color: #d2cfc6;
          font-size: clamp(16px, 1.7vw, 21px);
          font-weight: 500;
          letter-spacing: -.025em;
        }
        .lp-welcome__rule {
          width: 64px;
          height: 1px;
          margin: 28px 0 23px;
          border: 0;
          background: linear-gradient(90deg, var(--lp-gold), rgba(231, 189, 75, 0));
        }
        .lp-welcome__description {
          max-width: 390px;
          margin: 0;
          color: var(--lp-muted);
          font-size: 14px;
          line-height: 1.75;
        }
        .lp-welcome__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 34px;
        }
        .lp-welcome__button {
          min-height: 54px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 0 22px;
          border: 1px solid transparent;
          border-radius: 2px;
          color: #17140c;
          background: linear-gradient(180deg, #f0ce69, #d5a832);
          font: 700 11px var(--app-font-mono, monospace);
          letter-spacing: .11em;
          text-transform: uppercase;
          transition: transform .18s ease, opacity .18s ease, background .18s ease;
          cursor: pointer;
        }
        .lp-welcome__button:hover { transform: translateY(-2px); background: #f4d36e; }
        .lp-welcome__button:active { transform: translateY(0); }
        .lp-welcome__button:focus-visible {
          outline: 2px solid #f7df94;
          outline-offset: 4px;
        }
        .lp-welcome__button--quiet {
          border-color: rgba(231, 189, 75, .42);
          color: #e7e2d7;
          background: rgba(15, 15, 14, .55);
        }
        .lp-welcome__button--quiet:hover { background: rgba(231, 189, 75, .1); }
        .lp-welcome__arrow {
          display: inline-block;
          font-size: 16px;
          line-height: 1;
          transition: transform .18s ease;
        }
        .lp-welcome__button:hover .lp-welcome__arrow { transform: translateX(3px); }
        .lp-welcome__visual {
          position: relative;
          width: 100%;
          max-width: 700px;
          justify-self: end;
          animation: lp-arrive .95s .16s both;
        }
        .lp-welcome__visual::before {
          content: "";
          position: absolute;
          inset: 8% 5%;
          z-index: -1;
          border-radius: 50%;
          background: rgba(224, 173, 48, .09);
          filter: blur(55px);
        }
        .lp-welcome__image {
          display: block;
          width: 100%;
          height: auto;
          aspect-ratio: 1;
          object-fit: contain;
          border: 1px solid rgba(226, 184, 70, .21);
          box-shadow: 0 28px 90px rgba(0, 0, 0, .36);
        }
        .lp-welcome__image-caption {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 13px;
          color: #79766d;
          font: 9px var(--app-font-mono, monospace);
          letter-spacing: .15em;
          text-transform: uppercase;
        }
        .lp-welcome__footer {
          width: min(100%, 1320px);
          margin: auto auto 0;
          padding-top: 18px;
          border-top: 1px solid rgba(231, 189, 75, .18);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: #77766f;
          font: 9px var(--app-font-mono, monospace);
          letter-spacing: .12em;
          text-transform: uppercase;
        }
        .lp-welcome__footer span:last-child { color: #b49a54; }
        @keyframes lp-arrive {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (min-width: 1500px) {
          .lp-welcome__visual { max-width: 760px; }
        }
        @media (max-width: 760px) {
          .lp-welcome {
            padding: max(18px, env(safe-area-inset-top)) 20px max(18px, env(safe-area-inset-bottom));
          }
          .lp-welcome__header { min-height: 34px; }
          .lp-welcome__mark { gap: 10px; font-size: 10px; letter-spacing: .11em; }
          .lp-welcome__sigil { width: 26px; height: 26px; }
          .lp-welcome__edition { font-size: 8px; letter-spacing: .08em; }
          .lp-welcome__hero {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: center;
            gap: 23px;
            padding: clamp(30px, 6vh, 54px) 0 28px;
          }
          .lp-welcome__copy { max-width: 560px; }
          .lp-welcome__overline { margin-bottom: 19px; }
          .lp-welcome h1 { font-size: clamp(54px, 14vw, 92px); }
          .lp-welcome__tagline { margin-top: 19px; font-size: 17px; }
          .lp-welcome__rule { margin: 20px 0 16px; }
          .lp-welcome__description { font-size: 13px; }
          .lp-welcome__actions { margin-top: 24px; }
          .lp-welcome__button { min-height: 50px; padding: 0 17px; font-size: 10px; }
          .lp-welcome__visual { max-width: 440px; align-self: center; }
          .lp-welcome__image-caption { font-size: 8px; }
          .lp-welcome__footer { font-size: 8px; }
        }
        @media (max-width: 390px) {
          .lp-welcome { padding-left: 16px; padding-right: 16px; }
          .lp-welcome__edition { max-width: 110px; text-align: right; line-height: 1.5; }
          .lp-welcome__actions { display: grid; grid-template-columns: 1fr; }
          .lp-welcome__button { width: 100%; }
          .lp-welcome__footer { letter-spacing: .07em; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-welcome *, .lp-welcome *::before, .lp-welcome *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>
      <header className="lp-welcome__header">
        <div className="lp-welcome__mark" aria-label="Legendary Progression">
          <span className="lp-welcome__sigil" aria-hidden="true"><span>L</span></span>
          <span>LEGENDARY PROGRESSION</span>
        </div>
        <span className="lp-welcome__edition">Built for the long game</span>
      </header>

      <section className="lp-welcome__hero" aria-labelledby="welcome-heading">
        <div className="lp-welcome__copy">
          <p className="lp-welcome__overline">Your work. Your record.</p>
          <h1 id="welcome-heading">
            Train.
            <span>Progress.</span>
            Become Legendary.
          </h1>
          <p className="lp-welcome__tagline">Your training. Your progression.</p>
          <hr className="lp-welcome__rule" />
          <p className="lp-welcome__description">
            Your training history, plans, recovery, and personal records—together in one place.
            Build patiently. See what your work becomes.
          </p>
          <div className="lp-welcome__actions">
            <button className="lp-welcome__button" type="button" onClick={onCreateAccount} data-testid="button-create-account">
              CREATE ACCOUNT <span className="lp-welcome__arrow" aria-hidden="true">→</span>
            </button>
            <button className="lp-welcome__button lp-welcome__button--quiet" type="button" onClick={onLogIn} data-testid="button-log-in">
              LOG IN
            </button>
          </div>
        </div>

        <figure className="lp-welcome__visual">
          <img
            className="lp-welcome__image"
            src={`${import.meta.env.BASE_URL}legendary-dragon.png`}
            alt="Gold dragon emblem on a dark, textured background"
            width="1024"
            height="1024"
          />
          <figcaption className="lp-welcome__image-caption">
            <span>Strength, written over time</span>
            <span>Est. by effort</span>
          </figcaption>
        </figure>
      </section>

      <footer className="lp-welcome__footer">
        <span>Train with purpose</span>
        <span>Every session becomes part of the story</span>
      </footer>
    </main>
  );
}