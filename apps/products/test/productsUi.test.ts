import { describe, expect, it } from 'vitest';
import {
  closeDialogs,
  makeStore,
  openDelete,
  openEdit,
  openNew,
  selectListQuery,
  setPage,
  setQuery,
  setSort,
} from '../src/store.ts';

type Dialogs = { editing: unknown; deleting: unknown };

// The slice key is not part of the contract: find the sub-state that has the dialog fields.
const ui = (store: ReturnType<typeof makeStore>): Dialogs => {
  const found = Object.values(store.getState() as Record<string, unknown>).find(
    (v) => typeof v === 'object' && v !== null && 'editing' in v && 'deleting' in v,
  );
  if (!found) throw new Error('productsUi slice not found in state');
  return found as Dialogs;
};

const product = {
  id: 7,
  sku: 'SKU-7',
  name: 'Seven',
  price_cents: 700,
  stock: 3,
  created_at: '2026-11-18T00:00:00.000Z',
};
const other = { ...product, id: 8, sku: 'SKU-8', name: 'Eight' };

describe('productsUi', () => {
  it('Q-ui-sort: initial state, same column toggles order, new column resets to asc', () => {
    const store = makeStore();
    expect(selectListQuery(store.getState())).toEqual({
      page: 1,
      sort: 'id',
      order: 'asc',
      q: '',
    });
    expect(ui(store)).toMatchObject({ editing: null, deleting: null });

    store.dispatch(setSort('id'));
    expect(selectListQuery(store.getState())).toMatchObject({ sort: 'id', order: 'desc' });
    store.dispatch(setSort('id'));
    expect(selectListQuery(store.getState())).toMatchObject({ sort: 'id', order: 'asc' });

    store.dispatch(setSort('id'));
    store.dispatch(setSort('name'));
    expect(selectListQuery(store.getState())).toMatchObject({ sort: 'name', order: 'asc' });
    store.dispatch(setSort('name'));
    store.dispatch(setSort('price_cents'));
    expect(selectListQuery(store.getState())).toMatchObject({ sort: 'price_cents', order: 'asc' });
  });

  it('Q-ui-query-resets-page: setQuery sets q and returns to page 1; setPage alone keeps q', () => {
    const store = makeStore();
    store.dispatch(setPage(4));
    expect(selectListQuery(store.getState()).page).toBe(4);
    store.dispatch(setQuery('abc'));
    expect(selectListQuery(store.getState())).toMatchObject({ page: 1, q: 'abc' });
    store.dispatch(setPage(3));
    expect(selectListQuery(store.getState())).toMatchObject({ page: 3, q: 'abc' });
  });

  it('Q-ui-dialogs: open and close edit, new and delete dialogs', () => {
    const store = makeStore();
    store.dispatch(openNew());
    expect(ui(store)).toMatchObject({ editing: 'new', deleting: null });
    store.dispatch(openEdit(product));
    expect(ui(store)).toMatchObject({ editing: product, deleting: null });
    store.dispatch(closeDialogs());
    expect(ui(store)).toMatchObject({ editing: null, deleting: null });

    store.dispatch(openDelete(other));
    expect(ui(store)).toMatchObject({ deleting: other });
    store.dispatch(closeDialogs());
    expect(ui(store)).toMatchObject({ editing: null, deleting: null });
  });

  it('Q-ui-select: selectListQuery returns exactly page, sort, order and q', () => {
    const store = makeStore();
    store.dispatch(setSort('stock'));
    store.dispatch(setQuery('x'));
    store.dispatch(setPage(2));
    store.dispatch(openEdit(product));
    expect(selectListQuery(store.getState())).toEqual({
      page: 2,
      sort: 'stock',
      order: 'asc',
      q: 'x',
    });
  });

  it('Q-ui-fresh-store: two stores do not share state', () => {
    const a = makeStore();
    const b = makeStore();
    a.dispatch(setQuery('only-a'));
    a.dispatch(setPage(5));
    a.dispatch(openDelete(product));
    expect(selectListQuery(b.getState())).toEqual({ page: 1, sort: 'id', order: 'asc', q: '' });
    expect(ui(b)).toMatchObject({ editing: null, deleting: null });
    expect(selectListQuery(makeStore().getState()).q).toBe('');
  });
});
