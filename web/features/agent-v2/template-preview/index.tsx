'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { noop } from 'es-toolkit/function'
import { useMemo } from 'react'
import { agentSoulConfigToFormState } from '../agent-composer/conversions'
import { AgentComposerProvider } from '../agent-composer/provider'
import { AgentOrchestratePanel } from '../agent-detail/configure/components/orchestrate'

export function AgentTemplateOrchestration({
  agentId,
  appId,
  versionId,
  config,
}: {
  agentId: string
  appId: string
  versionId?: string
  config: AgentSoulConfig
}) {
  const draft = useMemo(() => agentSoulConfigToFormState(config), [config])

  return (
    <AgentComposerProvider initialDraft={draft}>
      <AgentOrchestratePanel
        agentId={agentId}
        trialAppId={appId}
        trialVersionId={versionId}
        currentModel={draft.model}
        showHeader={false}
        showPublishBar={false}
        className="max-w-none min-w-0 flex-1 rounded-none border-0 border-r border-divider-subtle"
        onSelectModel={noop}
      />
    </AgentComposerProvider>
  )
}
