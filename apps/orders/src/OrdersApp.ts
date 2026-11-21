import { on } from '@mfe/events';
import { createApp, h, reactive } from 'vue';
import type { MountContext } from '../../../federation.contract.ts';
import Orders from './Orders.vue';
import css from './orders.css?raw';
import selectCss from '@mfe/ui/select.css?raw';
import './telemetry.ts';

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

// The `mount` contract (RFC 0016). The app lives in an open shadow root on `el`: its styles are a
// <style> inside that root, never in document.head, and the lab's global CSS does not reach in.
// Custom properties (--ds1-*) and inherited properties (font, color) still cross the boundary.
export function mount(el: HTMLElement, ctx: MountContext): () => void {
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = selectCss + css;
  const container = document.createElement('div');
  container.className = 'orders';
  root.append(style, container);

  // The shell never remounts on a language switch: the remote follows `locale:changed` itself.
  const state = reactive({ locale: ctx.locale });
  const off = on('locale:changed', ({ locale }) => {
    state.locale = locale;
  });

  const app = createApp({ render: () => h(Orders, { locale: state.locale, report: ctx.onError }) });
  app.config.errorHandler = ctx.onError;
  app.mount(container);

  return () => {
    off();
    app.unmount();
    root.replaceChildren();
  };
}
