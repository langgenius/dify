'use client'

import type { ResolvedTheme, ThemePreference } from './theme'
import { useTheme } from 'next-themes'
import { useCallback } from 'react'
import { isThemePreference } from './theme'

type ThemePreferenceState = {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

export function useThemePreference(): ThemePreferenceState {
  const { theme, setTheme } = useTheme()
  const setPreference = useCallback(
    (preference: ThemePreference) => setTheme(preference),
    [setTheme],
  )

  return {
    preference: isThemePreference(theme) ? theme : 'system',
    setPreference,
  }
}

export function useResolvedTheme(): ResolvedTheme {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? 'dark' : 'light'
}
