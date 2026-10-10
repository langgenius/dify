import type { CommandContext } from './types'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { setLocaleOnClient } from '@/i18n/client'
import { useRouter } from '@/next/navigation'

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
  const appId = useAppStore((state) => state.appDetail?.id)
  const appMode = useAppStore((state) => state.appDetail?.mode)

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
