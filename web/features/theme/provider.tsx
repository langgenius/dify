import type { ThemeProviderProps as NextThemesProviderProps } from 'next-themes'
import type { ThemePreference } from './theme'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

type ThemeProviderProps = Pick<NextThemesProviderProps, 'children' | 'nonce'> & {
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
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}
