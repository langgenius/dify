'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type AgentBuildDraftBarProps = {
  changesCount: number
  disabled?: boolean
  isApplying?: boolean
  isDiscarding?: boolean
  onApply: () => void
  onDiscard: () => void
}

export function AgentBuildDraftBar({
  changesCount,
  disabled = false,
  isApplying = false,
  isDiscarding = false,
  onApply,
  onDiscard,
}: AgentBuildDraftBarProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCustom } = useTranslation('custom')
  const metaLabel = changesCount > 0
    ? t('agentDetail.configure.buildDraft.changes', { count: changesCount })
    : t('agentDetail.configure.buildDraft.noChanges')
  const applyDisabled = disabled || isDiscarding
  const discardDisabled = disabled || isApplying

  return (
    <div className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-2 pr-2 pl-4 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-2">
        <p className="min-w-0 truncate system-sm-semibold text-text-primary">
          {t('agentDetail.configure.buildDraft.title')}
        </p>
        <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
          {metaLabel}
        </p>
      </div>
      <Button
        type="button"
        variant="primary"
        loading={isApplying}
        disabled={applyDisabled}
        className="h-8 rounded-lg px-3"
        onClick={onApply}
      >
        {tCustom('apply')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        loading={isDiscarding}
        disabled={discardDisabled}
        className="h-8 rounded-lg px-3"
        onClick={onDiscard}
      >
        {t('agentDetail.configure.buildDraft.discard')}
      </Button>
    </div>
  )
}
