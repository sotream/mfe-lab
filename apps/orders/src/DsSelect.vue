<script setup lang="ts">
import { attachPopup, bindLabel, keyAction, type SelectOption } from '@mfe/ui/select-core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

let seq = 0;
const props = defineProps<{
  options: SelectOption[];
  modelValue: string;
  labelId?: string;
  ariaLabel?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = props.id ?? `ds-select-${++seq}`;
const listId = `${id}-list`;
const optionId = (i: number) => `${id}-opt-${i}`;
const trigger = ref<HTMLElement>();
const list = ref<HTMLElement>();
const open = ref(false);
const active = ref(0);
let typed = { buffer: '', at: 0 };
const selected = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

let unlabel = () => {};
let detach = () => {};
onMounted(() => (unlabel = bindLabel(trigger.value!, props.labelId)));
onBeforeUnmount(() => {
  unlabel();
  detach();
});

watch(open, async (now) => {
  detach();
  detach = () => {};
  if (!now) return;
  await nextTick(); // the list loses `hidden` first
  detach = attachPopup(trigger.value!, list.value!, () => (open.value = false));
});
watch(active, async () => {
  await nextTick();
  list.value?.children[active.value]?.scrollIntoView?.({ block: 'nearest' });
});

function commit(i: number) {
  const o = props.options[i];
  if (o && !o.disabled && o.value !== props.modelValue) emit('update:modelValue', o.value);
}

function onKey(e: KeyboardEvent) {
  if (props.disabled || e.ctrlKey || e.metaKey) return;
  const r = keyAction({ open: open.value, activeIndex: active.value, ...typed }, e.key, {
    options: props.options,
    selectedIndex: selected.value,
    alt: e.altKey,
  });
  typed = { buffer: r.buffer, at: r.at };
  if (r.preventDefault) e.preventDefault();
  open.value = r.open;
  active.value = r.activeIndex;
  if (r.select !== undefined) commit(r.select);
}

function onClick() {
  if (props.disabled) return;
  active.value = Math.max(selected.value, 0);
  open.value = !open.value;
}

function pick(i: number) {
  if (props.options[i]?.disabled) return;
  commit(i);
  open.value = false;
  trigger.value?.focus();
}
</script>

<template>
  <div class="ds1-select" data-ds="select">
    <div
      :id="id"
      ref="trigger"
      role="combobox"
      :tabindex="disabled ? -1 : 0"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open ? optionId(active) : undefined"
      :aria-labelledby="labelId"
      :aria-label="labelId ? undefined : ariaLabel"
      :aria-disabled="disabled || undefined"
      class="ds1-select-trigger"
      @click="onClick"
      @blur="open = false"
      @keydown="onKey"
    >
      <span class="ds1-select-value">{{ options[selected]?.label }}</span>
    </div>
    <div
      :id="listId"
      ref="list"
      role="listbox"
      popover="manual"
      :hidden="!open"
      :aria-labelledby="labelId"
      :aria-label="labelId ? undefined : ariaLabel"
      class="ds1-select-list"
      @mousedown.prevent
    >
      <div
        v-for="(o, i) in options"
        :id="optionId(i)"
        :key="o.value"
        role="option"
        :aria-selected="i === selected"
        :aria-disabled="o.disabled || undefined"
        :data-active="open && i === active"
        class="ds1-select-option"
        @click="pick(i)"
      >
        {{ o.label }}
      </div>
    </div>
    <input v-if="name" type="hidden" :name="name" :value="modelValue" />
  </div>
</template>
