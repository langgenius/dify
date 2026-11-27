import type { HumanInputFormSubmitData } from './chat/answer/human-input-content/type'
import type { InstalledAppConnectionsState } from '@/app/components/explore/installed-app/connections/provider'
import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import { useCallback, useEffect, useRef } from 'react'
import { reportRequestError } from '@/app/query-error-toast'
import { prepareHumanInputFormSubmission } from '@/service/human-input-submission'
import { submitHumanInputForm } from '@/service/share'
import { submitHumanInputForm as submitInstalledHumanInputForm } from '@/service/workflow'

type ChatConnections = Pick<
  ConnectionsState | InstalledAppConnectionsState,
  'canRun' | 'status' | 'runConfiguration'
>

export function getChatRunConnectionFields(
  connections: ChatConnections | null,
  conversationId: string,
  connectionSetupComplete: boolean,
) {
  if (
    connections &&
    (!connections.canRun ||
      (!conversationId && !connectionSetupComplete && connections.status !== 'inactive'))
  )
    return null

  const configuration = connections?.runConfiguration
  if (!configuration) return {}

  return {
    connection_revision: configuration.connection_revision,
    connections: { ...configuration.connections },
  }
}

export function useChatHumanInputSubmission({
  connectionsReady,
  isInstalledApp,
  prepare,
}: {
  connectionsReady: boolean
  isInstalledApp: boolean
  prepare: Parameters<typeof prepareHumanInputFormSubmission>[0]
}) {
  const connectionsReadyRef = useRef(connectionsReady)
  useEffect(() => {
    connectionsReadyRef.current = connectionsReady
  }, [connectionsReady])

  return useCallback(
    async (formToken: string, formData: HumanInputFormSubmitData) => {
      if (!connectionsReadyRef.current) return
      const { form_version: formVersion, ...submission } = formData
      await prepareHumanInputFormSubmission(prepare)
      // Connection readiness can change while the paused workflow subscription is restored.
      if (!connectionsReadyRef.current) return

      const submit = isInstalledApp ? submitInstalledHumanInputForm : submitHumanInputForm
      try {
        await submit(formToken, submission, formVersion)
      } catch (error) {
        reportRequestError(error)
        throw error
      }
    },
    [isInstalledApp, prepare],
  )
}
