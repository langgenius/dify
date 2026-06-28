'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentConfigureComposerScope } from './components/composer-session'
import { AgentConfigurePageLoading } from './components/page-loading'
import { useAgentConfigureData } from './hooks'

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  return (
    <AgentConfigurePageContent agentId={agentId} />
  )
}

function AgentConfigurePageContent({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [composerRebaseRevision, setComposerRebaseRevision] = useState(0)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)

  if (configureData.isPending) {
    return (
      <AgentConfigurePageLoading label={t('agentDetail.sections.configure')} />
    )
  }

  return (
    <AgentConfigureComposerScope
      agentId={agentId}
      composerRebaseRevision={composerRebaseRevision}
      configureData={configureData}
      onComposerRebase={() => setComposerRebaseRevision(revision => revision + 1)}
      onSelectVersion={setSelectedVersionId}
    />
  )
}
