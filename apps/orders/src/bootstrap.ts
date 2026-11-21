import { getState, login, subscribe } from '@mfe/auth-store';
import '@mfe/ui/base.css';
import './standalone.css';
import { messages } from './messages.ts';
import { mount } from './OrdersApp.ts';

// Standalone dev page (not part of the exposed module): the same `mount` the shell calls, plus a
// sign-in bar. Plain DOM, so this entry pulls in no React either.
function detectLocale(): 'de' | 'en' {
  try {
    const saved = localStorage.getItem('mfe-lab:locale');
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    // storage unavailable: same as not saved
  }
  return navigator.languages.find((l) => l.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

const locale = detectLocale();
document.documentElement.lang = locale;
const t = messages[locale].standalone;

const bar = document.createElement('div');
bar.className = 'orders-standalone-bar';
const title = document.createElement('span');
title.className = 'orders-standalone-title';
title.textContent = t.title;
bar.append(title);
for (const role of ['admin', 'editor', 'viewer']) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = role;
  button.onclick = () => void login(`${role}@lab.test`, 'lab12345').catch(() => {});
  bar.append(button);
}
const who = document.createElement('span');
bar.append(who);
const showUser = () => {
  const { user } = getState();
  who.textContent = user ? t.signedIn(user.email, user.role) : t.signedOut;
};
showUser();
subscribe(showUser);

const host = document.createElement('div');
document.getElementById('root')!.append(bar, host);
mount(host, { locale, onError: (e) => console.error('[orders]', e) });
