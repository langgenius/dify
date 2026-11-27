'use client'

import type {
  AgentConfigSnapshotSummaryResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { AgentConfigurationPanel } from './configuration'
import { useAgentEditorModel } from './model'

type AgentRosterConfigurationPanelProps = {
  agentId?: string
  nodeId: string
  open: boolean
}

export function AgentRosterConfigurationPanel(props: AgentRosterConfigurationPanelProps) {
  const { agentId, nodeId, open } = props
  const { t } = useTranslation(['common'])
  const rosterComposerQuery = useQuery(
    consoleQuery.agent.byAgentId.composer.get.queryOptions({
      input:
        open && agentId
          ? {
              params: {
                agent_id: agentId,
              },
            }
          : skipToken,
    }),
  )
  const composerState = rosterComposerQuery.data
  const agentSoulConfig = composerState?.agent_soul
  const activeConfigSnapshot =
    'active_config_snapshot' in (composerState ?? {})
      ? (composerState?.active_config_snapshot as
          | AgentConfigSnapshotSummaryResponse
          | null
          | undefined)
      : undefined

  const composerLoad = useOwnedQueryError(rosterComposerQuery)
  const loadErrorMessage = useRequestErrorMessage(
    composerLoad?.error,
    t(($) => $['api.actionFailed']),
  )

  if (loadErrorMessage) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg p-4">
        <Alert type="error">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button size="small" loading={composerLoad?.retrying} onClick={composerLoad?.retry}>
              {t(($) => $['operation.retry'])}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  if (!agentId || !agentSoulConfig) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
        <LoadingPlaceholder className="h-full" />
      </div>
    )
  }

  const initialAgentSoulConfig = agentSoulConfig as AgentSoulConfig
  const composerSessionKey = `${agentId ?? nodeId}:${activeConfigSnapshot?.id ?? 'draft'}`

  return (
    <AgentComposerProvider
      key={composerSessionKey}
      initialDraft={agentSoulConfigToFormState(initialAgentSoulConfig)}
    >
      <AgentRosterConfigurationContent agentId={agentId} composerState={composerState} />
    </AgentComposerProvider>
  )
}

function AgentRosterConfigurationContent({
  agentId,
  composerState,
}: {
  agentId: string
  composerState?: {
    agent?: {
      name?: string | null
    } | null
  }
}) {
  const { currentModel, setConfigureModel } = useAgentEditorModel()

  return (
    <AgentConfigurationPanel
      agentId={agentId}
      agentName={composerState?.agent?.name}
      currentModel={currentModel}
      readOnly
      showHeader={false}
      showPublishBar={false}
      className="h-full max-w-none min-w-0 flex-none rounded-none border-0"
      onSelectModel={setConfigureModel}
    />
  )
}
