'use client'

import { useState } from 'react'
import { useTranslation } from '#i18n'
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
  const isConfigureDataPending = configureData.agentQuery.isPending
    || configureData.composerQuery.isPending
    || (configureData.shouldLoadVersion && configureData.versionQuery.isPending)

  if (isConfigureDataPending) {
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
