/**
 * AXSHARE Desktop — Tauri 2 (Fase 7).
 * Entry point for the webview.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
