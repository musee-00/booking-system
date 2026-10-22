import { useEffect, useState } from 'react'

// Light/dark mode. The theme is the data-theme attribute on <html>; App.css
// switches its colour tokens on it. index.html sets it before the page draws
// (same rules as getPreferredTheme), so there's no flash of the wrong theme.
const STORAGE_KEY = 'theme'
const systemQuery = () => window.matchMedia('(prefers-color-scheme: light)')

const readSaved = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null // e.g. private mode with storage blocked
  }
}

// A choice the visitor made wins; otherwise follow the device's setting.
export const getPreferredTheme = () => readSaved() || (systemQuery().matches ? 'light' : 'dark')

const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || getPreferredTheme())

  // Until the visitor picks a theme themselves, follow the device if it changes
  // (e.g. macOS switching to dark mode in the evening).
  useEffect(() => {
    const query = systemQuery()
    const onSystemChange = () => {
      if (readSaved()) return
      const next = query.matches ? 'light' : 'dark'
      applyTheme(next)
      setTheme(next)
    }
    query.addEventListener('change', onSystemChange)
    return () => query.removeEventListener('change', onSystemChange)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not saved, but the switch still works for this visit.
    }
  }

  return { theme, toggleTheme }
}
