'use client'

import type { AgentBuildDraftChangeSummary } from './build-draft-changes-context'
import { Button } from '@langgenius/dify-ui/button'
import { CollapsiblePanel, CollapsibleRoot } from '@langgenius/dify-ui/collapsible'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentBuildGridTexture } from '../build-grid-texture'
import { AgentBuildDraftChangesPanel } from './build-draft-changes-panel'

type AgentBuildDraftBarProps = {
  changeSummary?: AgentBuildDraftChangeSummary
  changesCount: number
  disabled?: boolean
  isApplying?: boolean
  isDiscarding?: boolean
  onApply: () => void
  onDiscard: () => void
}

export function AgentBuildDraftBar({
  changeSummary,
  changesCount,
  disabled = false,
  isApplying = false,
  isDiscarding = false,
  onApply,
  onDiscard,
}: AgentBuildDraftBarProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCustom } = useTranslation('custom')
  const [open, setOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>()
  const collapsedBarRef = useRef<HTMLDivElement>(null)
  const changesPanelId = useId()
  const isActionPending = isApplying || isDiscarding
  const applyDisabled = disabled || isActionPending
  const discardDisabled = disabled || isActionPending
  const changesLabel = t('agentDetail.configure.buildDraft.changesToApply', { count: changesCount })
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const width = collapsedBarRef.current?.getBoundingClientRect().width

      if (width)
        setPanelWidth(width)
    }
    else {
      setPanelWidth(undefined)
    }

    setOpen(nextOpen)
  }

  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={handleOpenChange}
      role="group"
      aria-label={t('agentDetail.configure.buildDraft.title')}
      className="group/build-draft pointer-events-auto relative w-full max-w-full min-w-0 overflow-hidden rounded-xl border-[1.5px] border-[#A0BDFF] bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
    >
      <AgentBuildGridTexture
        aria-hidden
        cellOpacityMultiplier={3}
        className="pointer-events-none absolute top-[-104px] left-[-1171px] z-0 opacity-70"
        dotClassName="bg-[#5C90FF]"
      />
      <CollapsiblePanel id={changesPanelId} className="relative z-1" style={panelWidth ? { width: panelWidth } : undefined}>
        <AgentBuildDraftChangesPanel
          changeSummary={changeSummary}
          changesLabel={changesLabel}
          onToggle={() => handleOpenChange(!open)}
        />
      </CollapsiblePanel>
      <div ref={collapsedBarRef} className="relative z-1 flex h-[50px] max-w-full min-w-0 items-center gap-2 p-2 group-data-open/build-draft:justify-end">
        <div className="flex min-w-0 flex-1 items-center gap-3 pr-8 pl-2 group-data-open/build-draft:hidden">
          <p className="min-w-0 truncate system-sm-semibold text-text-primary">
            {t('agentDetail.configure.buildDraft.title')}
          </p>
          <button
            type="button"
            aria-controls={changesPanelId}
            aria-expanded={open}
            className="flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => handleOpenChange(true)}
          >
            <span className="min-w-0 truncate system-xs-regular">
              {changesLabel}
            </span>
            <span aria-hidden className="i-ri-arrow-right-s-line size-4 shrink-0" />
          </button>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={discardDisabled}
          className="relative z-1 h-8 shrink-0 rounded-lg px-3"
          onClick={onDiscard}
        >
          {t('agentDetail.configure.buildDraft.discard')}
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={isApplying}
          disabled={applyDisabled}
          className="relative z-1 h-8 min-w-20 shrink-0 rounded-lg px-3"
          onClick={onApply}
        >
          {tCustom('apply')}
        </Button>
      </div>
    </CollapsibleRoot>
  )
}
