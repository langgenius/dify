'use client'

import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'

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
  const communityEditionIsolationTip = t($ => $['agentDetail.configure.communityEditionIsolationTip'])

  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex h-6 min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate title-xl-semi-bold text-text-primary">
            {t($ => $['agentDetail.configure.title'])}
          </h2>
          <Popover>
            <PopoverTrigger
              openOnHover
              delay={300}
              closeDelay={200}
              aria-label={communityEditionIsolationTip}
              render={(
                <button
                  type="button"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                >
                  <span aria-hidden className="i-custom-vender-line-alertsAndFeedback-alert-triangle size-4 text-text-warning-secondary" />
                </button>
              )}
            />
            <PopoverContent
              placement="bottom"
              popupClassName="max-w-[320px] px-3 py-2 system-xs-regular text-text-tertiary"
            >
              {communityEditionIsolationTip}
            </PopoverContent>
          </Popover>
          {isBuildDraftActive && (
            <span className="flex min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-accent-secondary">
              {t($ => $['agentDetail.configure.buildDraft.modeBadge'])}
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
          {t($ => $['agentDetail.configure.buildDraft.modeDescription'])}
        </p>
      )}
    </div>
  )
}
