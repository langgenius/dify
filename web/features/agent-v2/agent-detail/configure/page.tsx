'use client'

import type { AgentConfigureRightPanelMode } from './state'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_CE_EDITION } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LicenseStatus } from '@/features/system-features/constants'
import { AgentConfigureComposerScope } from './components/composer-session'
import { AgentConfigurePageLoading } from './components/page-loading'
import { useAgentConfigureData } from './hooks'
import {
  AGENT_CONFIGURE_RIGHT_PANEL_MODES,
  agentConfigureComposerRebaseRevisionAtom,
  agentConfigureScopedAtoms,
  agentConfigureSelectedVersionIdAtom,
  agentConfigureSelectVersionAtom,
  rebaseAgentConfigureComposerAtom,
} from './state'

const agentConfigureModeQueryParser = parseAsStringLiteral(AGENT_CONFIGURE_RIGHT_PANEL_MODES)
  .withDefault('build')
  .withOptions({ history: 'replace' })

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({ agentId }: AgentConfigurePageProps) {
  return (
    <ScopeProvider key={agentId} atoms={agentConfigureScopedAtoms} name="AgentConfigure">
      <AgentConfigurePageContent agentId={agentId} />
    </ScopeProvider>
  )
}

function AgentConfigurePageContent({ agentId }: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const [requestedMode, setRequestedMode] = useQueryState('mode', agentConfigureModeQueryParser)
  const selectedVersionId = useAtomValue(agentConfigureSelectedVersionIdAtom)
  const composerRebaseRevision = useAtomValue(agentConfigureComposerRebaseRevisionAtom)
  const rebaseComposer = useSetAtom(rebaseAgentConfigureComposerAtom)
  const selectVersion = useSetAtom(agentConfigureSelectVersionAtom)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const previewEnabled =
    !IS_CE_EDITION ||
    systemFeatures.license.status === LicenseStatus.ACTIVE ||
    systemFeatures.license.status === LicenseStatus.EXPIRING
  const rightPanelMode = requestedMode === 'preview' && previewEnabled ? 'preview' : 'build'
  const changeRightPanelMode = useCallback(
    (nextMode: AgentConfigureRightPanelMode) => {
      if (nextMode === 'preview' && !previewEnabled) return

      return setRequestedMode(nextMode)
    },
    [previewEnabled, setRequestedMode],
  )

  if (configureData.isPending) {
    return <AgentConfigurePageLoading label={t(($) => $['agentDetail.sections.configure'])} />
  }

  return (
    <AgentConfigureComposerScope
      agentId={agentId}
      composerRebaseRevision={composerRebaseRevision}
      configureData={configureData}
      previewEnabled={previewEnabled}
      rightPanelMode={rightPanelMode}
      onComposerRebase={rebaseComposer}
      onRightPanelModeChange={changeRightPanelMode}
      onSelectVersion={selectVersion}
    />
  )
}
