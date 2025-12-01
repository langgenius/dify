'use client'
import { useEffect } from 'react'
import type { ActionItem } from '../types'
import { slashCommandRegistry } from './registry'
import { executeCommand } from './command-bus'
import { useTheme } from 'next-themes'
import { setLocaleOnClient } from '@/i18n-config'
import { themeCommand } from './theme'
import { languageCommand } from './language'
import { forumCommand } from './forum'
import { docsCommand } from './docs'
import { communityCommand } from './community'
import { accountCommand } from './account'
import i18n from '@/i18n-config/i18next-config'

export const slashAction: ActionItem = {
  key: '/',
  shortcut: '/',
  title: i18n.t('app.gotoAnything.actions.slashTitle'),
  description: i18n.t('app.gotoAnything.actions.slashDesc'),
  action: (result) => {
    if (result.type !== 'command') return
    const { command, args } = result.data
    executeCommand(command, args)
  },
  search: async (query, _searchTerm = '') => {
    // Delegate all search logic to the command registry system
    return slashCommandRegistry.search(query, i18n.language)
  },
}

// Register/unregister default handlers for slash commands with external dependencies.
export const registerSlashCommands = (deps: Record<string, any>) => {
  // Register command handlers to the registry system with their respective dependencies
  slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
  slashCommandRegistry.register(languageCommand, { setLocale: deps.setLocale })
  slashCommandRegistry.register(forumCommand, {})
  slashCommandRegistry.register(docsCommand, {})
  slashCommandRegistry.register(communityCommand, {})
  slashCommandRegistry.register(accountCommand, {})
}

export const unregisterSlashCommands = () => {
  // Remove command handlers from registry system (automatically calls each command's unregister method)
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('forum')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('community')
  slashCommandRegistry.unregister('account')
}

export const SlashCommandProvider = () => {
  const theme = useTheme()
  useEffect(() => {
    registerSlashCommands({
      setTheme: theme.setTheme,
      setLocale: setLocaleOnClient,
    })
    return () => unregisterSlashCommands()
  }, [theme.setTheme])

  return null
}
