'use client'

import type { ReactNode } from 'react'
import { useTranslation } from '#i18n'
type AgentOrchestrateHeaderProps = {
  headingId: string
  trailingAction?: ReactNode
  isBuildDraftActive?: boolean
}

export function AgentOrchestrateHeader({
  headingId,
  trailingAction,
  isBuildDraftActive = false,
}: AgentOrchestrateHeaderProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex h-6 min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate title-xl-semi-bold text-text-primary">
            {t('agentDetail.configure.title')}
          </h2>
          {isBuildDraftActive && (
            <span className="flex min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-accent-secondary">
              {t('agentDetail.configure.buildDraft.modeBadge')}
            </span>
          )}
        </div>
        {trailingAction != null && (
          <div className="shrink-0">
            {trailingAction}
          </div>
        )}
      </div>
      {isBuildDraftActive && (
        <p className="mt-1 w-full system-xs-regular text-text-tertiary">
          {t('agentDetail.configure.buildDraft.modeDescription')}
        </p>
      )}
    </div>
  )
}
