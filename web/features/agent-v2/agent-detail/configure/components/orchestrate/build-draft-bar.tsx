'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { AgentBuildGridTexture } from '../build-grid-texture'

type AgentBuildDraftBarProps = {
  changesCount: number
  disabled?: boolean
  isApplying?: boolean
  isDiscarding?: boolean
  onApply: () => void
  onDiscard: () => void
}

export function AgentBuildDraftBar({
  disabled = false,
  isApplying = false,
  isDiscarding = false,
  onApply,
  onDiscard,
}: AgentBuildDraftBarProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCustom } = useTranslation('custom')
  const isActionPending = isApplying || isDiscarding
  const applyDisabled = disabled || isActionPending
  const discardDisabled = disabled || isActionPending

  return (
    <div className="pointer-events-auto relative flex h-[50px] w-fit max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border-[1.5px] border-[#A0BDFF] bg-components-panel-bg-blur p-2 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]">
      <AgentBuildGridTexture
        aria-hidden
        cellOpacityMultiplier={3}
        className="pointer-events-none absolute top-[-104px] left-[-1171px] z-0 opacity-70"
        dotClassName="bg-[#5C90FF]"
      />
      <div className="relative z-1 flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-8 pl-2">
        <p className="min-w-0 truncate system-sm-semibold text-text-primary">
          {t('agentDetail.configure.buildDraft.title')}
        </p>
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
  )
}
