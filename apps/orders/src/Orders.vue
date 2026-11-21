<script setup lang="ts">
import {
  listOrders,
  listProducts,
  type Order,
  type OrderStatus,
  type Product,
} from '@mfe/api-client';
import { getState, subscribe } from '@mfe/auth-store';
import { on } from '@mfe/events';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { formatDate, formatMoney, type Locale } from './format.ts';
import { messages } from './messages.ts';

const props = defineProps<{ locale: Locale; report: (error: unknown) => void }>();

const PAGE_SIZE = 10;
const SKELETON_WIDTHS = ['62%', '72%', '55%', '68%', '60%', '75%'];
const STATUSES: OrderStatus[] = ['new', 'paid', 'shipped'];

const t = computed(() => messages[props.locale]);
const status = ref<OrderStatus | ''>('');
const page = ref(1);
const orders = ref<Order[]>([]);
const total = ref(0);
// ponytail: GET /orders carries only product_id, so names and prices come from the first 100
// products; an order for a later product shows "Product <id>" and no total. Join in the API if it matters.
const products = ref(new Map<number, Product>());
const state = ref<'loading' | 'ready' | 'error'>('loading');
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

// Only the newest request may write (a slow answer must not overwrite a newer one).
let latest = 0;
async function load() {
  const mine = ++latest;
  state.value = 'loading';
  try {
    const [list, prods] = await Promise.all([
      listOrders({ page: page.value, limit: PAGE_SIZE, status: status.value || undefined }),
      listProducts({ limit: 100 }),
    ]);
    if (mine !== latest) return;
    orders.value = list.items;
    total.value = list.total;
    products.value = new Map(prods.items.map((p) => [p.id, p]));
    state.value = 'ready';
  } catch (error) {
    if (mine !== latest) return;
    state.value = 'error';
    props.report(error);
  }
}

watch(status, () => {
  page.value = 1;
  void load();
});
watch(page, () => void load());

const productName = (o: Order) =>
  products.value.get(o.product_id)?.name ?? t.value.unknownProduct(o.product_id);
const orderTotal = (o: Order) => {
  const p = products.value.get(o.product_id);
  return p ? formatMoney(p.price_cents * o.qty, props.locale) : '—';
};

let userId = getState().user?.id;
const stops: (() => void)[] = [];
onMounted(() => {
  void load();
  // Another remote changed products (RFC 0006): names and prices may be stale.
  stops.push(on('products:changed', () => void load()));
  // A different user signed in (or the token arrived late, standalone): fetch as that user.
  stops.push(
    subscribe(() => {
      const next = getState().user?.id;
      if (next !== userId) {
        userId = next;
        if (next !== undefined) void load();
      }
    }),
  );
});
onUnmounted(() => stops.forEach((stop) => stop()));
</script>

<template>
  <div class="orders-toolbar">
    <label for="orders-status">{{ t.filter }}</label>
    <select id="orders-status" v-model="status" class="orders-input">
      <option value="">{{ t.all }}</option>
      <option v-for="s in STATUSES" :key="s" :value="s">{{ t.status[s] }}</option>
    </select>
    <span class="orders-count">{{ t.total(total) }}</span>
  </div>

  <p v-if="state === 'loading'" role="status" class="orders-hidden">{{ t.loading }}</p>
  <div v-else-if="state === 'error'" role="alert" class="orders-error">
    <p>{{ t.failed }}</p>
    <button type="button" class="orders-button" @click="load">{{ t.retry }}</button>
  </div>
  <p v-else-if="orders.length === 0" role="status" class="orders-note">{{ t.empty }}</p>

  <div
    v-if="state === 'loading' || (state === 'ready' && orders.length > 0)"
    class="orders-wrap"
    role="region"
    tabindex="0"
    :aria-label="t.caption"
  >
    <table class="orders-table" :aria-busy="state === 'loading' ? 'true' : undefined">
      <caption class="orders-hidden">
        {{
          t.caption
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t.cols.id }}</th>
          <th scope="col">{{ t.cols.product }}</th>
          <th scope="col" class="orders-num">{{ t.cols.qty }}</th>
          <th scope="col" class="orders-num">{{ t.cols.total }}</th>
          <th scope="col">{{ t.cols.status }}</th>
          <th scope="col">{{ t.cols.date }}</th>
        </tr>
      </thead>
      <tbody v-if="state === 'loading'">
        <tr v-for="r in PAGE_SIZE" :key="r" class="orders-skeleton-row" aria-hidden="true">
          <td v-for="c in 6" :key="c">
            <span class="orders-skeleton" :style="{ width: SKELETON_WIDTHS[(r + c) % 6] }"></span>
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr v-for="o in orders" :key="o.id">
          <th scope="row" class="orders-mono">{{ o.id }}</th>
          <td>{{ productName(o) }}</td>
          <td class="orders-num">{{ o.qty }}</td>
          <td class="orders-num">{{ orderTotal(o) }}</td>
          <td>
            <span :class="['orders-chip', `orders-chip--${o.status}`]">{{
              t.status[o.status]
            }}</span>
          </td>
          <td class="orders-mono">
            <time :datetime="o.created_at">{{ formatDate(o.created_at, locale) }}</time>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="state === 'loading'" class="orders-pager" aria-hidden="true">
    <span class="orders-skeleton orders-skeleton--button"></span>
    <span class="orders-skeleton" style="width: 5rem"></span>
    <span class="orders-skeleton orders-skeleton--button"></span>
  </div>
  <div v-else-if="pages > 1" class="orders-pager">
    <button type="button" class="orders-button" :disabled="page <= 1" @click="page--">
      {{ t.prev }}
    </button>
    <span>{{ t.page(page, pages) }}</span>
    <button type="button" class="orders-button" :disabled="page >= pages" @click="page++">
      {{ t.next }}
    </button>
  </div>
</template>
