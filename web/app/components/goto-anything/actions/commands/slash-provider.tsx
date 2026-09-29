'use client'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { useEffect, useLayoutEffect } from 'react'
import { ENABLE_FEATURE_PREVIEW } from '@/config'
import { useDocLink } from '@/context/i18n'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { setLocaleOnClient } from '@/i18n/client'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { accountCommand } from './account'
import { createCreateCommand } from './create'
import { discordCommand } from './discord'
import { docsCommand } from './docs'
import { goCommand } from './go'
import { languageCommand } from './language'
import { modelsCommand } from './models'
import { createRefineCommand } from './refine'
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
}

const unregisterSlashCommands = () => {
  slashCommandRegistry.unregister('theme')
  slashCommandRegistry.unregister('language')
  slashCommandRegistry.unregister('docs')
  slashCommandRegistry.unregister('discord')
  slashCommandRegistry.unregister('models')
  slashCommandRegistry.unregister('account')
  slashCommandRegistry.unregister('go')
}

export const SlashCommandProvider = () => {
  const params = useParams()
  const appId = typeof params.appId === 'string' ? params.appId : undefined
  const { data: appMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (app) => app.mode,
    }),
  )
  useLayoutEffect(() => {
    if (!ENABLE_FEATURE_PREVIEW) return
    const currentApp = appId && appMode ? { id: appId, mode: appMode } : undefined
    slashCommandRegistry.register(createCreateCommand(currentApp), {})
    slashCommandRegistry.register(createRefineCommand(currentApp), {})
    return () => {
      slashCommandRegistry.unregister('create')
      slashCommandRegistry.unregister('refine')
    }
  }, [appId, appMode])

  const theme = useTheme()
  const getDocsHomeUrl = useDocLink()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const agentsAvailable = isAgentV2Enabled()
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
