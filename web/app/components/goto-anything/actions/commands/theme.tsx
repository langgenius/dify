import type { SlashCommandHandler } from './types'
import type { CommandSearchResult } from '../types'
import type { ReactNode } from 'react'
import React from 'react'
import { RiComputerLine, RiMoonLine, RiSunLine } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Theme dependency types
type ThemeDeps = {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
}

const THEME_ITEMS: { id: 'light' | 'dark' | 'system'; titleKey: string; descKey: string; icon: ReactNode }[] = [
  {
    id: 'system',
    titleKey: 'app.gotoAnything.actions.themeSystem',
    descKey: 'app.gotoAnything.actions.themeSystemDesc',
    icon: <RiComputerLine className='h-4 w-4 text-text-tertiary' />,
  },
  {
    id: 'light',
    titleKey: 'app.gotoAnything.actions.themeLight',
    descKey: 'app.gotoAnything.actions.themeLightDesc',
    icon: <RiSunLine className='h-4 w-4 text-text-tertiary' />,
  },
  {
    id: 'dark',
    titleKey: 'app.gotoAnything.actions.themeDark',
    descKey: 'app.gotoAnything.actions.themeDarkDesc',
    icon: <RiMoonLine className='h-4 w-4 text-text-tertiary' />,
  },
]

const buildThemeCommands = (query: string, locale?: string): CommandSearchResult[] => {
  const q = query.toLowerCase()
  const list = THEME_ITEMS.filter(item =>
    !q
    || i18n.t(item.titleKey, { lng: locale }).toLowerCase().includes(q)
    || item.id.includes(q),
  )
  return list.map(item => ({
    id: item.id,
    title: i18n.t(item.titleKey, { lng: locale }),
    description: i18n.t(item.descKey, { lng: locale }),
    type: 'command' as const,
    icon: (
      <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
        {item.icon}
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

  async search(args: string, locale: string = 'en') {
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
