import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import BloxityProvider from './bloxity/BloxityProvider.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* The Boxity slug is mine-antarctica (shared/boxity.js); VITE_GAME_SLUG overrides it. */}
    <BloxityProvider>
      <App />
    </BloxityProvider>
  </StrictMode>,
)
