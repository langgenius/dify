'use client'
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { useEffect } from 'react'
import { ENABLE_FEATURE_PREVIEW } from '@/config'
import { useDocLink } from '@/context/i18n'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { useCanManageAgents } from '@/features/agent-v2/permissions'
import { setLocaleOnClient } from '@/i18n-config'
import { accountCommand } from './account'
import { createCommand } from './create'
import { discordCommand } from './discord'
import { docsCommand } from './docs'
import { goCommand } from './go'
import { languageCommand } from './language'
import { modelsCommand } from './models'
import { refineCommand } from './refine'
import { slashCommandRegistry } from './registry'
import { themeCommand } from './theme'

type SlashCommandDeps = {
  agentsAvailable: boolean
  getDocsHomeUrl: () => string
  setTheme: (theme: string) => void
  setLocale: typeof setLocaleOnClient
  skillsAvailable: boolean
}

const registerSlashCommands = (deps: SlashCommandDeps) => {
  slashCommandRegistry.register(themeCommand, { setTheme: deps.setTheme })
  slashCommandRegistry.register(languageCommand, {
    setLocale: deps.setLocale as (locale: string) => Promise<void>,
  })
  slashCommandRegistry.register(docsCommand, { getDocsHomeUrl: deps.getDocsHomeUrl })
  slashCommandRegistry.register(discordCommand, {})
  slashCommandRegistry.register(modelsCommand, {})
  slashCommandRegistry.register(accountCommand, {})
  slashCommandRegistry.register(goCommand, {
    agentsAvailable: deps.agentsAvailable,
    skillsAvailable: deps.skillsAvailable,
  })
  if (ENABLE_FEATURE_PREVIEW) {
    slashCommandRegistry.register(createCommand, {})
    slashCommandRegistry.register(refineCommand, {})
  }
}

const unregisterSlashCommands = () => {
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('discord')
  slashCommandRegistry.unregister('models')
  slashCommandRegistry.unregister('account')
  slashCommandRegistry.unregister('go')
  slashCommandRegistry.unregister('create')
  slashCommandRegistry.unregister('refine')
}

export const SlashCommandProvider = () => {
  const theme = useTheme()
  const getDocsHomeUrl = useDocLink()
  const canManageAgents = useCanManageAgents()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const agentsAvailable = isAgentV2Enabled() && canManageAgents
  const skillsAvailable = !isCurrentWorkspaceDatasetOperator
  useEffect(() => {
    registerSlashCommands({
      agentsAvailable,
      getDocsHomeUrl,
      setTheme: theme.setTheme,
      setLocale: setLocaleOnClient,
      skillsAvailable,
    })
    return () => unregisterSlashCommands()
  }, [agentsAvailable, getDocsHomeUrl, skillsAvailable, theme.setTheme])

  return null
}
