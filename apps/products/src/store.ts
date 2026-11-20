import type { Product, ProductQuery } from '@mfe/api-client';
import { configureStore, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type Sort = NonNullable<ProductQuery['sort']>;
export type ListQuery = { page: number; sort: Sort; order: 'asc' | 'desc'; q: string };
export type ProductsUiState = ListQuery & {
  editing: Product | 'new' | null;
  deleting: Product | null;
};

const initialState: ProductsUiState = {
  page: 1,
  sort: 'id',
  order: 'asc',
  q: '',
  editing: null,
  deleting: null,
};

const slice = createSlice({
  name: 'productsUi',
  initialState,
  reducers: {
    setPage(s, a: PayloadAction<number>) {
      s.page = a.payload;
    },
    setSort(s, a: PayloadAction<Sort>) {
      s.order = s.sort === a.payload && s.order === 'asc' ? 'desc' : 'asc';
      s.sort = a.payload;
      s.page = 1;
    },
    setQuery(s, a: PayloadAction<string>) {
      if (s.q === a.payload) return;
      s.q = a.payload;
      s.page = 1;
    },
    openNew(s) {
      s.editing = 'new';
    },
    openEdit(s, a: PayloadAction<Product>) {
      s.editing = a.payload;
    },
    openDelete(s, a: PayloadAction<Product>) {
      s.deleting = a.payload;
    },
    closeDialogs(s) {
      s.editing = null;
      s.deleting = null;
    },
  },
});

export const { setPage, setSort, setQuery, openNew, openEdit, openDelete, closeDialogs } =
  slice.actions;
export const productsUiReducer = slice.reducer;

export const makeStore = () => configureStore({ reducer: { productsUi: slice.reducer } });
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const selectListQuery = createSelector(
  [
    (s: RootState) => s.productsUi.page,
    (s: RootState) => s.productsUi.sort,
    (s: RootState) => s.productsUi.order,
    (s: RootState) => s.productsUi.q,
  ],
  (page, sort, order, q): ListQuery => ({ page, sort, order, q }),
);
