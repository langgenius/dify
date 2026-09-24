'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { noop } from 'es-toolkit/function'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['explore'])
  const headingId = useId()
  const draft = useMemo(() => agentSoulConfigToFormState(config), [config])

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 basis-1/2 flex-col overflow-hidden bg-components-panel-bg @max-[599px]/agent-preview:h-[65dvh] @max-[599px]/agent-preview:flex-none"
    >
      <h2 id={headingId} className="shrink-0 px-4 py-3 title-xl-semi-bold text-text-primary">
        {t(($) => $['tryApp.agentConfiguration'])}
      </h2>
      <AgentComposerProvider initialDraft={draft}>
        <AgentOrchestratePanel
          agentId={agentId}
          trialAppId={appId}
          trialVersionId={versionId}
          currentModel={draft.model}
          showHeader={false}
          showPublishBar={false}
          className="min-h-0 max-w-none min-w-0 flex-1 rounded-none border-0"
          onSelectModel={noop}
        />
      </AgentComposerProvider>
    </section>
  )
}
