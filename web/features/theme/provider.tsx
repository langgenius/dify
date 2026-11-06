import type { ReactNode } from 'react'
import type { ThemePreference } from './theme'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

type ThemeProviderProps = {
  children: ReactNode
  nonce?: string | undefined
  defaultPreference?: ThemePreference
}

export function ThemeProvider({
  children,
  nonce,
  defaultPreference = 'system',
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={defaultPreference}
      enableSystem
      disableTransitionOnChange
      {...(nonce === undefined ? {} : { nonce })}
    >
      {children}
    </NextThemesProvider>
  )
}
