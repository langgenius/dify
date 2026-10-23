import type { CommandContext } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n/client'
import { useParams, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}
const openGenerator: CommandContext['openGenerator'] = (options) =>
  useWorkflowGeneratorStore.getState().openGenerator(options)

export function useCommandContext(
  agentsAvailable: boolean,
  skillsAvailable: boolean,
  isWorkflowPage: boolean,
): CommandContext {
  const { t, i18n } = useTranslation(['app', 'common', 'modelProvider', 'accountSettings'])
  const { setTheme } = useTheme()
  const { push } = useRouter()
  const getDocsHomeUrl = useDocLink()
  const { appId: routeAppId } = useParams<{ appId?: string }>()
  // Only the app workflow page has an app id param that names an app; other routes reuse the
  // `appId` segment for different resources (for example installed apps).
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: routeAppId ? { params: { app_id: routeAppId } } : skipToken,
      enabled: isWorkflowPage,
    }),
  )
  const appId = appDetail?.id
  const appMode = appDetail?.mode

  return useMemo<CommandContext>(
    () => ({
      t,
      locale: i18n.language,
      agentsAvailable,
      skillsAvailable,
      currentApp:
        isWorkflowPage && appId && (appMode === 'workflow' || appMode === 'advanced-chat')
          ? { id: appId, mode: appMode }
          : null,
      setTheme,
      setLocale: setLocaleOnClient,
      getDocsHomeUrl,
      navigate: push,
      onError: (error) => {
        console.error('Goto Anything command failed:', error)
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      },
      openExternal,
      openGenerator,
    }),
    [
      t,
      i18n.language,
      agentsAvailable,
      skillsAvailable,
      isWorkflowPage,
      appId,
      appMode,
      setTheme,
      getDocsHomeUrl,
      push,
    ],
  )
}
