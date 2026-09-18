export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'commit-review-theme'

export function readStoredTheme(): ThemePreference | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    /* ignore */
  }
  return null
}

export function systemTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function effectiveTheme(): ThemePreference {
  return readStoredTheme() ?? systemTheme()
}

export function applyTheme(theme: ThemePreference | null): void {
  if (theme) document.documentElement.setAttribute('data-theme', theme)
  else document.documentElement.removeAttribute('data-theme')
}

/** Apply stored override on boot, or leave unset so CSS follows the system. */
export function initTheme(): ThemePreference {
  const stored = readStoredTheme()
  applyTheme(stored)
  return stored ?? systemTheme()
}

/** Toggle light/dark and persist the choice. */
export function toggleStoredTheme(): ThemePreference {
  const next: ThemePreference = effectiveTheme() === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  applyTheme(next)
  return next
}
