'use client'
import { useEffect } from 'react'
import type { ActionItem, CommandSearchResult } from './types'
import { buildLanguageCommands, buildLanguageRootItem } from './run-language'
import { buildThemeCommands, buildThemeRootItem } from './run-theme'
import i18n from '@/i18n-config/i18next-config'
import { executeCommand, registerCommands, unregisterCommands } from './command-bus'
import { useTheme } from 'next-themes'
import { setLocaleOnClient } from '@/i18n-config'

const rootParser = (query: string): CommandSearchResult[] => {
  const q = query.toLowerCase()
  const items: CommandSearchResult[] = []
  if (!q || 'theme'.includes(q))
    items.push(buildThemeRootItem())
  if (!q || 'language'.includes(q) || 'lang'.includes(q))
    items.push(buildLanguageRootItem())
  return items
}

type RunContext = {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
  setLocale?: (locale: string) => Promise<void>
  search?: (query: string) => void
}

export const commandAction: ActionItem = {
  key: '@run',
  shortcut: '@run',
  title: i18n.t('app.gotoAnything.actions.runTitle'),
  description: i18n.t('app.gotoAnything.actions.runDesc'),
  action: (result) => {
    if (result.type !== 'command') return
    const { command, args } = result.data
    if (command === 'theme.set') {
      executeCommand('theme.set', args)
      return
    }
    if (command === 'i18n.set') {
      executeCommand('i18n.set', args)
      return
    }
    if (command === 'nav.search')
      executeCommand('nav.search', args)
  },
  search: async (_, searchTerm = '') => {
    const q = searchTerm.trim()
    if (q.startsWith('theme'))
      return buildThemeCommands(q.replace(/^theme\s*/, ''), i18n.language)
    if (q.startsWith('language') || q.startsWith('lang'))
      return buildLanguageCommands(q.replace(/^(language|lang)\s*/, ''))

    // root categories
    return rootParser(q)
  },
}

// Register/unregister default handlers for @run commands with external dependencies.
export const registerRunCommands = (deps: {
  setTheme?: (value: 'light' | 'dark' | 'system') => void
  setLocale?: (locale: string) => Promise<void>
  search?: (query: string) => void
}) => {
  registerCommands({
    'theme.set': async (args) => {
      deps.setTheme?.(args?.value)
    },
    'i18n.set': async (args) => {
      const locale = args?.locale
      if (locale)
        await deps.setLocale?.(locale)
    },
    'nav.search': (args) => {
      const q = args?.query
      if (q)
        deps.search?.(q)
    },
  })
}

export const unregisterRunCommands = () => {
  unregisterCommands(['theme.set', 'i18n.set', 'nav.search'])
}

export const RunCommandProvider = ({ onNavSearch }: { onNavSearch?: (q: string) => void }) => {
  const theme = useTheme()
  useEffect(() => {
    registerRunCommands({
      setTheme: theme.setTheme,
      setLocale: setLocaleOnClient,
      search: onNavSearch,
    })
    return () => unregisterRunCommands()
  }, [theme.setTheme, onNavSearch])

  return null
}
