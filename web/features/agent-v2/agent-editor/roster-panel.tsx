'use client'

import type {
  AgentConfigSnapshotSummaryResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { agentSoulConfigToFormState } from '@/features/agent-v2/agent-composer/conversions'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/console'
import { AgentConfigurationPanel } from './configuration'
import { useAgentEditorModel } from './model'

type AgentRosterConfigurationPanelProps = {
  agentId?: string
  nodeId: string
  open: boolean
}

export function AgentRosterConfigurationPanel(props: AgentRosterConfigurationPanelProps) {
  const { agentId, nodeId, open } = props
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
