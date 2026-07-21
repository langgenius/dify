'use client'

import type { AgentConfigureRightPanelMode } from './state'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect } from 'react'
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

const agentConfigureModeQueryParser = parseAsStringLiteral(
  AGENT_CONFIGURE_RIGHT_PANEL_MODES,
).withOptions({ history: 'replace' })

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
  const [modeInUrl, setModeInUrl] = useQueryState('mode', agentConfigureModeQueryParser)
  const selectedVersionId = useAtomValue(agentConfigureSelectedVersionIdAtom)
  const composerRebaseRevision = useAtomValue(agentConfigureComposerRebaseRevisionAtom)
  const rebaseComposer = useSetAtom(rebaseAgentConfigureComposerAtom)
  const selectVersion = useSetAtom(agentConfigureSelectVersionAtom)
  const configureData = useAgentConfigureData(agentId, selectedVersionId)
  const { data: systemFeatures, isPending: isSystemFeaturesPending } = useQuery(
    systemFeaturesQueryOptions(),
  )
  const previewEnabled =
    !IS_CE_EDITION ||
    systemFeatures?.license.status === LicenseStatus.ACTIVE ||
    systemFeatures?.license.status === LicenseStatus.EXPIRING
  const requestedMode = modeInUrl ?? 'build'
  const rightPanelMode = previewEnabled ? requestedMode : 'build'
  const changeRightPanelMode = useCallback(
    (nextMode: AgentConfigureRightPanelMode) => {
      if (nextMode === 'preview' && !previewEnabled) return

      void setModeInUrl(nextMode)
    },
    [previewEnabled, setModeInUrl],
  )

  useEffect(() => {
    if ((IS_CE_EDITION && isSystemFeaturesPending) || modeInUrl === rightPanelMode) return

    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The URL is external state and must mirror the effective mode after parsing and license gating.
    void setModeInUrl(rightPanelMode, { history: 'replace' })
  }, [isSystemFeaturesPending, modeInUrl, rightPanelMode, setModeInUrl])

  if (configureData.isPending || (IS_CE_EDITION && isSystemFeaturesPending)) {
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
