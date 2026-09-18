import type { CommandSearchResult } from '../types'
import type { SlashCommandHandler } from './types'
import { getI18n } from 'react-i18next'
import { registerCommands, unregisterCommands } from './command-bus'

// Theme dependency types
type ThemeDeps = {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
}

const THEME_ITEMS = [
  {
    id: 'system',
    titleKey: 'gotoAnything.actions.themeSystem',
    descKey: 'gotoAnything.actions.themeSystemDesc',
    iconClassName: 'i-ri-computer-line',
  },
  {
    id: 'light',
    titleKey: 'gotoAnything.actions.themeLight',
    descKey: 'gotoAnything.actions.themeLightDesc',
    iconClassName: 'i-ri-sun-line',
  },
  {
    id: 'dark',
    titleKey: 'gotoAnything.actions.themeDark',
    descKey: 'gotoAnything.actions.themeDarkDesc',
    iconClassName: 'i-ri-moon-line',
  },
] as const

const buildThemeCommands = (query: string, locale?: string): CommandSearchResult[] => {
  const i18n = getI18n()
  const q = query.toLowerCase()
  const list = THEME_ITEMS.filter(
    (item) =>
      !q ||
      i18n
        .t(($) => $[item.titleKey], { ns: 'app', lng: locale })
        .toLowerCase()
        .includes(q) ||
      item.id.includes(q),
  )
  return list.map((item) => ({
    id: item.id,
    title: i18n.t(($) => $[item.titleKey], { ns: 'app', lng: locale }),
    description: i18n.t(($) => $[item.descKey], { ns: 'app', lng: locale }),
    type: 'command' as const,
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
        <span aria-hidden className={`${item.iconClassName} size-4 text-text-tertiary`} />
      </div>
    ),
    data: { command: 'theme.set', args: { value: item.id } },
  }))
}

/**
 * Theme command handler
 * Integrates UI building, search, and registration logic
 */
export const themeCommand: SlashCommandHandler<ThemeDeps> = {
  name: 'theme',
  description: 'Switch between light and dark themes',
  mode: 'submenu', // Explicitly set submenu mode

  search(args: string, locale: string = 'en') {
    // Return theme options directly, regardless of parameters
    return buildThemeCommands(args, locale)
  },

  register(deps: ThemeDeps) {
    registerCommands({
      'theme.set': async (args) => {
        deps.setTheme?.(args?.value)
      },
    })
  },

  unregister() {
    unregisterCommands(['theme.set'])
  },
}
