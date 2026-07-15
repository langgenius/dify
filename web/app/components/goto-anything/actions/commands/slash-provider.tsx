'use client'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { ENABLE_FEATURE_PREVIEW } from '@/config'
import { setLocaleOnClient } from '@/i18n-config'
import { accountCommand } from './account'
import { communityCommand } from './community'
import { createCommand } from './create'
import { docsCommand } from './docs'
import { forumCommand } from './forum'
import { goCommand } from './go'
import { languageCommand } from './language'
import { refineCommand } from './refine'
import { slashCommandRegistry } from './registry'
import { themeCommand } from './theme'

type SlashCommandDeps = {
  setTheme: (theme: string) => void
  setLocale: typeof setLocaleOnClient
}

const registerSlashCommands = (deps: SlashCommandDeps) => {
  slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
  slashCommandRegistry.register(languageCommand, {
    setLocale: deps.setLocale as (locale: string) => Promise<void>,
  })
  slashCommandRegistry.register(forumCommand, {})
  slashCommandRegistry.register(docsCommand, {})
  slashCommandRegistry.register(communityCommand, {})
  slashCommandRegistry.register(accountCommand, {})
  slashCommandRegistry.register(goCommand, {})
  if (ENABLE_FEATURE_PREVIEW) {
    slashCommandRegistry.register(createCommand, {})
    slashCommandRegistry.register(refineCommand, {})
  }
}

const unregisterSlashCommands = () => {
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('forum')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('community')
  slashCommandRegistry.unregister('account')
  slashCommandRegistry.unregister('go')
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
