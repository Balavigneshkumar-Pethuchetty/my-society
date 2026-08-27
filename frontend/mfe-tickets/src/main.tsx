import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
import { TicketsApp } from './TicketsApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <TicketsApp token={null} />
    </I18nextProvider>
  </React.StrictMode>
);
