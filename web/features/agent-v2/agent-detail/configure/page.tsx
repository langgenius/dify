'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { AgentConfigureComposerScope } from './components/composer-session'
import { AgentConfigurePageLoading } from './components/page-loading'
import { useAgentConfigureData } from './hooks'
import {
  agentConfigureComposerRebaseRevisionAtom,
  agentConfigureScopedAtoms,
  agentConfigureSelectedVersionIdAtom,
  agentConfigureSelectVersionAtom,
  rebaseAgentConfigureComposerAtom,
} from './state'

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({
  agentId,
}: AgentConfigurePageProps) {
  return (
    <ScopeProvider
      key={agentId}
      atoms={agentConfigureScopedAtoms}
      name="AgentConfigure"
    >
      <AgentConfigurePageContent agentId={agentId} />
    </ScopeProvider>
  )
}

function AgentConfigurePageContent({
  agentId,
}: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const selectedVersionId = useAtomValue(agentConfigureSelectedVersionIdAtom)
  const composerRebaseRevision = useAtomValue(agentConfigureComposerRebaseRevisionAtom)
  const rebaseComposer = useSetAtom(rebaseAgentConfigureComposerAtom)
  const selectVersion = useSetAtom(agentConfigureSelectVersionAtom)
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
      onComposerRebase={rebaseComposer}
      onSelectVersion={selectVersion}
    />
  )
}
