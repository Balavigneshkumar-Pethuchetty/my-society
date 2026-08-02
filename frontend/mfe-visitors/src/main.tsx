import React from 'react';
import ReactDOM from 'react-dom/client';
import { VisitorResidentApp } from './VisitorResidentApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VisitorResidentApp token={null} />
  </React.StrictMode>
);
