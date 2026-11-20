import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './App.tsx';
import { startEventLog } from './eventLog.ts';
import { prefetchRemotes } from './remotes.ts';
import './styles.css';

startEventLog();
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);

if ('requestIdleCallback' in window) requestIdleCallback(prefetchRemotes);
else setTimeout(prefetchRemotes, 200);
