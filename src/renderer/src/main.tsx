import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { flushPersistence, initApp } from './state/app';
import { initSerial, refreshPorts } from './state/serial';
import { checkForUpdates } from './state/updates';
import './styles/tokens.css';
import './styles/app.css';

async function start(): Promise<void> {
  await initApp();
  initSerial();
  await refreshPorts();
  // A little later, so the window is ready before a notice may appear.
  setTimeout(() => void checkForUpdates(false), 2500);
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

window.smp.app.onCloseRequested(() => {
  void flushPersistence().finally(() => window.smp.app.closeReady());
});
void start();
