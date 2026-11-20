import { useLocale } from '@mfe/ui';
import { useT } from './messages.ts';

export function ImpressumPage() {
  const t = useT().impressum;
  const locale = useLocale();
  return (
    <div className="legal">
      <div className="page-head">
        <h1 tabIndex={-1}>
          {locale === 'de' ? (
            t.h1
          ) : (
            <>
              {t.h1} (<span lang="de">Impressum</span>)
            </>
          )}
        </h1>
      </div>
      {/* The notice itself is German law text: always German, marked so screen readers switch voice. */}
      <section lang="de">
        <h2>Angaben gemäß § 5 DDG</h2>
        <address>
          Max Mustermann
          <br />
          Musterstraße 1
          <br />
          12345 Musterstadt
          <br />
          Deutschland
          <br />
          Telefon: <a href="tel:+49301234567">+49 30 1234567</a>
          <br />
          E-Mail: <a href="mailto:max@mustermann.example">max@mustermann.example</a>
        </address>
      </section>
      <p className="legal-note">{t.note}</p>
    </div>
  );
}

export function DatenschutzPage() {
  const t = useT().privacy;
  return (
    <div className="legal">
      <div className="page-head">
        <h1 tabIndex={-1}>{t.h1}</h1>
        <p className="lead">{t.intro}</p>
      </div>
      <ul>
        {t.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
