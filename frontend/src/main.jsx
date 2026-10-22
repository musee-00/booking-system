import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { SHOP } from './shop.js'

// Browser tab title follows src/shop.js (index.html has the same text for the first paint).
document.title = SHOP.name

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
