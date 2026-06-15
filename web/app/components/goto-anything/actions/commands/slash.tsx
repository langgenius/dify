'use client'
import type { ActionItem } from '../types'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { getI18n } from 'react-i18next'
import { ENABLE_FEATURE_PREVIEW } from '@/config'
import { setLocaleOnClient } from '@/i18n-config'
import { accountCommand } from './account'
import { executeCommand } from './command-bus'
import { communityCommand } from './community'
import { createCommand } from './create'
import { docsCommand } from './docs'
import { forumCommand } from './forum'
import { goCommand } from './go'
import { languageCommand } from './language'
import { refineCommand } from './refine'
import { slashCommandRegistry } from './registry'
import { themeCommand } from './theme'
import { zenCommand } from './zen'

export const slashAction: ActionItem = {
  key: '/',
  shortcut: '/',
  get title() {
    const i18n = getI18n()
    return i18n.t('gotoAnything.actions.slashTitle', { ns: 'app' })
  },
  get description() {
    const i18n = getI18n()
    return i18n.t('gotoAnything.actions.slashDesc', { ns: 'app' })
  },
  action: (result) => {
    if (result.type !== 'command')
      return
    const { command, args } = result.data
    executeCommand(command, args)
  },
  search: async (query, _searchTerm = '') => {
    const i18n = getI18n()
    // Delegate all search logic to the command registry system
    return slashCommandRegistry.search(query, i18n.language)
  },
}

// Register/unregister default handlers for slash commands with external dependencies.
const registerSlashCommands = (deps: Record<string, any>) => {
  // Register command handlers to the registry system with their respective dependencies
  slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
  slashCommandRegistry.register(languageCommand, { setLocale: deps.setLocale })
  slashCommandRegistry.register(forumCommand, {})
  slashCommandRegistry.register(docsCommand, {})
  slashCommandRegistry.register(communityCommand, {})
  slashCommandRegistry.register(accountCommand, {})
  slashCommandRegistry.register(zenCommand, {})
  slashCommandRegistry.register(goCommand, {})
  // `/create` and `/refine` are preview features, gated behind a flag.
  if (ENABLE_FEATURE_PREVIEW) {
    slashCommandRegistry.register(createCommand, {})
    slashCommandRegistry.register(refineCommand, {})
  }
}

const unregisterSlashCommands = () => {
  // Remove command handlers from registry system (automatically calls each command's unregister method)
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('forum')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('community')
  slashCommandRegistry.unregister('account')
  slashCommandRegistry.unregister('zen')
  slashCommandRegistry.unregister('go')
  // No-op when the preview flag is off and these were never registered.
  slashCommandRegistry.unregister('create')
  slashCommandRegistry.unregister('refine')
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
