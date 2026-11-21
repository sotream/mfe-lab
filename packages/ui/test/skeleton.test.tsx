/** @vitest-environment jsdom */
// Q-skeleton-ui. ASSUMPTIONS (phase 2 adapts): `Skeleton` is exported from ../src/index.ts with width/height/radius;
// Table `loading={{ rows }}` keeps the caller's <thead> child and renders `rows` aria-hidden body rows itself.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteFrame, Skeleton, Table, type RemoteModule } from '../src/index.ts';

afterEach(cleanup);

const head = (
  <thead>
    <tr>
      <th>SKU</th>
      <th>Name</th>
    </tr>
  </thead>
);

describe('Table loading', () => {
  it('Q-skeleton-ui: renders caption, thead and N aria-hidden body rows, table is busy, no data text', () => {
    const { container } = render(
      <Table label="Products" loading={{ rows: 5 }}>
        {head}
      </Table>,
    );
    const table = container.querySelector('table')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(table.querySelector('caption')?.textContent).toBe('Products');
    expect(table.querySelectorAll('thead th')).toHaveLength(2);
    const body = table.querySelectorAll('tbody tr');
    expect(body).toHaveLength(5);
    for (const tr of body) {
      expect(tr.getAttribute('aria-hidden')).toBe('true');
      expect(tr.querySelector('.ds1-skeleton')).not.toBeNull();
      expect((tr.textContent ?? '').trim()).toBe('');
    }
    expect(table.textContent).not.toMatch(/REAL|\d/);
  });

  it('Q-skeleton-ui: without loading there is no aria-busy and no skeleton', () => {
    const { container } = render(
      <Table label="Products">
        {head}
        <tbody>
          <tr>
            <td>real</td>
            <td>row</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.querySelector('table')!.hasAttribute('aria-busy')).toBe(false);
    expect(container.querySelector('.ds1-skeleton')).toBeNull();
    expect(screen.getByText('real')).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('Q-skeleton-ui: a span with the class and the requested size', () => {
    const { container } = render(<Skeleton width={120} height="1.5rem" radius={6} />);
    const el = container.querySelector('.ds1-skeleton') as HTMLElement;
    expect(el.tagName).toBe('SPAN');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('1.5rem');
    expect(el.style.borderRadius).toBe('6px');
  });

  it('Q-skeleton-ui: string sizes pass through', () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.querySelector('.ds1-skeleton') as HTMLElement;
    expect(el.style.width).toBe('50%');
    expect(el.style.height).toBe('2rem');
  });
});

describe('RemoteFrame fallback', () => {
  it('Q-skeleton-ui: shows the fallback and a role=status text while the load is pending, then the remote', async () => {
    let done!: (m: RemoteModule) => void;
    const pending = new Promise<RemoteModule>((r) => (done = r));
    await act(async () => {
      render(
        <RemoteFrame
          name="products"
          load={() => pending}
          fallback={<div data-testid="my-fallback">shape</div>}
        />,
      );
    });
    const section = screen.getByRole('region', { name: 'products remote' });
    expect(within(section).getByTestId('my-fallback')).toBeTruthy();
    expect(within(section).getByRole('status').textContent).toContain('Loading products');
    await act(async () => done({ default: () => <p>remote ok</p> }));
    expect(await screen.findByText('remote ok')).toBeTruthy();
    expect(screen.queryByTestId('my-fallback')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Q-skeleton-ui: without a fallback a generic skeleton block is shown with the status text', async () => {
    const pending = new Promise<RemoteModule>(() => {});
    await act(async () => {
      render(<RemoteFrame name="products" load={() => pending} />);
    });
    const section = screen.getByRole('region', { name: 'products remote' });
    expect(section.querySelector('.ds1-skeleton')).not.toBeNull();
    expect(within(section).getByRole('status').textContent).toContain('Loading products');
  });
});
