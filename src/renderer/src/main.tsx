import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'
import './i18n/config'

// Apply saved theme before first paint
document.documentElement.className = localStorage.getItem('theme') || 'dark'

// Prevent Electron/Chromium from navigating when files are dropped anywhere on the window
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
