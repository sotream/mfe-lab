import { useId, type InputHTMLAttributes } from 'react';
import './tokens.css';
import './ds1.css';

type Props = { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, error, id: given, ...input }: Props) {
  const generated = useId();
  const id = given ?? generated;
  const errorId = `${id}-error`;
  return (
    <div data-ds="field" className="ds1-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="ds1-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
