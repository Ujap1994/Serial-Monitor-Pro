import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { flushPersistence, initApp } from './state/app';
import { initSerial, refreshPorts } from './state/serial';
import './styles/tokens.css';
import './styles/app.css';

async function start(): Promise<void> {
  await initApp();
  initSerial();
  await refreshPorts();
  window.addEventListener('beforeunload', flushPersistence);
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
