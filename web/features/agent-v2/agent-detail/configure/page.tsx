'use client'

import type { AgentConfigureRightPanelMode } from './state'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { Suspense, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
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

const agentConfigureModeQueryParser = parseAsStringLiteral(
  AGENT_CONFIGURE_RIGHT_PANEL_MODES,
).withOptions({ history: 'replace' })

type AgentConfigurePageProps = {
  agentId: string
}

export function AgentConfigurePage({ agentId }: AgentConfigurePageProps) {
  const { t } = useTranslation('agentV2')
  const loadingLabel = t(($) => $['agentDetail.sections.configure'])

  return (
    <Suspense fallback={<AgentConfigurePageLoading label={loadingLabel} />}>
      <ScopeProvider key={agentId} atoms={agentConfigureScopedAtoms} name="AgentConfigure">
        <AgentConfigurePageContent agentId={agentId} loadingLabel={loadingLabel} />
      </ScopeProvider>
    </Suspense>
  )
}

function AgentConfigurePageContent({
  agentId,
  loadingLabel,
}: AgentConfigurePageProps & { loadingLabel: string }) {
  const [modeInUrl, setModeInUrl] = useQueryState('mode', agentConfigureModeQueryParser)
  const selectedVersionId = useAtomValue(agentConfigureSelectedVersionIdAtom)
  const composerRebaseRevision = useAtomValue(agentConfigureComposerRebaseRevisionAtom)
  const rebaseComposer = useSetAtom(rebaseAgentConfigureComposerAtom)
  const selectVersion = useSetAtom(agentConfigureSelectVersionAtom)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const previewEnabled = systemFeatures.deployment_edition !== 'COMMUNITY'
  const requestedMode = modeInUrl ?? 'build'
  const rightPanelMode = previewEnabled ? requestedMode : 'build'
  const changeRightPanelMode = useCallback(
    (nextMode: AgentConfigureRightPanelMode) => {
      if (nextMode === 'preview' && !previewEnabled) return

      return setModeInUrl(nextMode)
    },
    [previewEnabled, setModeInUrl],
  )

  useEffect(() => {
    if (modeInUrl === rightPanelMode) return

    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The URL is external state and must mirror the effective mode after parsing and license gating.
    void setModeInUrl(rightPanelMode, { history: 'replace' })
  }, [modeInUrl, rightPanelMode, setModeInUrl])

  if (configureData.isPending) {
    return <AgentConfigurePageLoading label={loadingLabel} />
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
