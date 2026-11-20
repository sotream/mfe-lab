/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteFrame } from '../src/index.ts';

afterEach(cleanup);

describe('RemoteFrame bar', () => {
  it('Q-frame-bar: name and port are separate elements, no middle dot, build stamp kept', async () => {
    await act(
      async () =>
        void render(
          <RemoteFrame
            name="products"
            port={3001}
            load={() => Promise.resolve({ default: () => <p>ok</p>, buildVersion: 'v1' })}
          />,
        ),
    );
    const section = screen.getByRole('region', { name: 'products remote' });
    const name = within(section).getByText('products', { exact: true });
    const port = within(section).getByText(':3001', { exact: true });
    expect(name).not.toBe(port);
    expect(name.contains(port) || port.contains(name)).toBe(false);
    expect(section.textContent).not.toContain('·');
    expect(await within(section).findByText('build v1')).toBeTruthy();
  });
});
