import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureBrowserOutput, logger } from './lib/log';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

/* Before anything else: a mount error, a React warning or a promise rejected
   during start-up must already find the channel open, otherwise those are
   precisely the ones we will not see. */
captureBrowserOutput();

const log = logger('boot');
log.info('start-up', {
  url: window.location.href,
  mode: import.meta.env.MODE,
  language: navigator.language,
  screen: `${window.innerWidth}×${window.innerHeight}`,
  online: navigator.onLine,
});

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
