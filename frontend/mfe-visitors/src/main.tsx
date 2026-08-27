import './i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { VisitorResidentApp } from './VisitorResidentApp';
import i18n from './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <VisitorResidentApp token={null} />
    </I18nextProvider>
  </React.StrictMode>
);
