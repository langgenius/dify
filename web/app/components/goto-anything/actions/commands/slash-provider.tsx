'use client'
import type { Locale } from '@/i18n-config'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { setLocaleOnClient } from '@/i18n-config'
import { accountCommand } from './account'
import { communityCommand } from './community'
import { docsCommand } from './docs'
import { forumCommand } from './forum'
import { goCommand } from './go'
import { languageCommand } from './language'
import { slashCommandRegistry } from './registry'
import { themeCommand } from './theme'

type SlashCommandDeps = {
  setTheme: (theme: string) => void
  setLocale: (locale: string) => Promise<void>
}

const registerSlashCommands = (deps: SlashCommandDeps) => {
  slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
  slashCommandRegistry.register(languageCommand, { setLocale: deps.setLocale })
  slashCommandRegistry.register(forumCommand, {})
  slashCommandRegistry.register(docsCommand, {})
  slashCommandRegistry.register(communityCommand, {})
  slashCommandRegistry.register(accountCommand, {})
  slashCommandRegistry.register(goCommand, {})
}

const unregisterSlashCommands = () => {
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('forum')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('community')
  slashCommandRegistry.unregister('account')
  slashCommandRegistry.unregister('go')
}

export const SlashCommandProvider = () => {
  const theme = useTheme()
  useEffect(() => {
    registerSlashCommands({
      setTheme: theme.setTheme,
      setLocale: locale => setLocaleOnClient(locale as Locale),
    })
    return () => unregisterSlashCommands()
  }, [theme.setTheme])

  return null
}
