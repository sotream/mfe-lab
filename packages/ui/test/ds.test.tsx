/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Field, Table } from '../src/index.ts';

afterEach(cleanup);

describe('Button', () => {
  it('Q-ds-button: default variant is secondary, type is button', () => {
    render(<Button>Go</Button>);
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('data-ds')).toBe('button');
    expect(b.getAttribute('data-variant')).toBe('secondary');
    expect(b.classList.contains('ds1-button')).toBe(true);
    expect(b.classList.contains('ds1-button--secondary')).toBe(true);
    expect(b.getAttribute('type')).toBe('button');
  });

  it('Q-ds-button: danger variant, explicit type, disabled', () => {
    render(
      <Button variant="danger" type="submit" disabled>
        Del
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Del' }) as HTMLButtonElement;
    expect(b.classList.contains('ds1-button--danger')).toBe(true);
    expect(b.getAttribute('data-variant')).toBe('danger');
    expect(b.type).toBe('submit');
    expect(b.disabled).toBe(true);
  });

  it('Q-ds-button: onClick fires', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Hit
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hit' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Table', () => {
  it('Q-ds-table: data-ds, class, role table, children pass through', () => {
    render(
      <Table>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </Table>,
    );
    const t = screen.getByRole('table');
    expect(t.getAttribute('data-ds')).toBe('table');
    expect(t.classList.contains('ds1-table')).toBe(true);
    expect(screen.getByRole('cell', { name: 'cell' })).toBeTruthy();
  });
});

describe('Table region', () => {
  const body = (
    <tbody>
      <tr>
        <td>cell</td>
      </tr>
    </tbody>
  );

  it('Q-table-region: with label, a focusable region named by it wraps the table', () => {
    render(<Table label="Products">{body}</Table>);
    const region = screen.getByRole('region', { name: 'Products' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.classList.contains('ds1-table-wrap')).toBe(true);
    expect(region.contains(screen.getByRole('table'))).toBe(true);
  });

  it('Q-table-region: without label, no region and no tabindex', () => {
    const { container } = render(<Table>{body}</Table>);
    expect(screen.queryByRole('region')).toBeNull();
    const wrap = container.querySelector('.ds1-table-wrap') as HTMLElement;
    expect(wrap.hasAttribute('role')).toBe(false);
    expect(wrap.hasAttribute('tabindex')).toBe(false);
  });
});

describe('Field', () => {
  it('Q-ds-field: label is tied to the input, wrapper has data-ds, no error means no aria-invalid', () => {
    const { container } = render(<Field label="Name" defaultValue="x" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('x');
    expect(container.querySelector('[data-ds="field"]')).not.toBeNull();
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(container.querySelector('p')).toBeNull();
  });

  it('Q-ds-field: error text is the accessible description and aria-invalid is true', () => {
    render(<Field label="Price" error="Must be positive" />);
    const input = screen.getByLabelText('Price');
    expect(screen.getByText('Must be positive').tagName).toBe('P');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const id = input.getAttribute('aria-describedby') ?? '';
    expect(id).not.toBe('');
    // jest-dom is not installed, so resolve the description by hand.
    expect(document.getElementById(id)?.textContent).toBe('Must be positive');
  });
});
