import type { ResolvedTheme } from '@/features/theme/theme'

export function getAppliedTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

// Zendesk renders in its own iframe and expects concrete CSS colors.
export const zendeskThemes = {
  light: {
    primary: '#0033ff',
    onPrimary: '#ffffff',
    action: '#0033ff',
    onAction: '#ffffff',
    background: '#ffffff',
    onBackground: '#101828',
    message: '#0033ff',
    onMessage: '#ffffff',
    businessMessage: '#f2f4f7',
    onBusinessMessage: '#101828',
    card: '#f9fafb',
    onCard: '#101828',
    input: '#f9fafb',
    onInput: '#101828',
    elevated: '#ffffff',
    onElevated: '#101828',
    onSecondaryAction: '#0033ff',
  },
  dark: {
    primary: '#085afc',
    onPrimary: '#ffffff',
    action: '#085afc',
    onAction: '#ffffff',
    background: '#222225',
    onBackground: '#fbfbfc',
    message: '#085afc',
    onMessage: '#ffffff',
    businessMessage: '#3a3a40',
    onBusinessMessage: '#fbfbfc',
    card: '#27272b',
    onCard: '#fbfbfc',
    input: '#27272b',
    onInput: '#fbfbfc',
    elevated: '#3a3a40',
    onElevated: '#fbfbfc',
    onSecondaryAction: '#6694ff',
  },
} satisfies Record<ResolvedTheme, Record<string, string>>

export type ZendeskTheme = (typeof zendeskThemes)[ResolvedTheme]
