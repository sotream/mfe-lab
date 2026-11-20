import { useLocale } from './locale.ts';

const de = {
  unavailable: (name: string) => `${name} ist nicht verfügbar`,
  retry: 'Erneut versuchen',
  loading: (name: string) => `${name} wird geladen…`,
  remote: (name: string) => `${name}-Remote`,
};

const en: typeof de = {
  unavailable: (name) => `${name} is unavailable`,
  retry: 'Retry',
  loading: (name) => `Loading ${name}…`,
  remote: (name) => `${name} remote`,
};

const messages = { de, en };
export const useT = () => messages[useLocale()];
