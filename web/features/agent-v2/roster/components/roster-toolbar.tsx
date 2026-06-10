'use client'

import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { CreateAgentDialog } from './create-agent-dialog'

type RosterToolbarProps = {
  draftAgents: number
  inUseAgents: number
  keyword: string
  totalAgents: number
  onKeywordChange: (value: string) => void
}

type RosterFilterItemProps = {
  count: number
  disabled?: boolean
  label: string
  value: string
}

function RosterFilterItem({
  count,
  disabled,
  label,
  value,
}: RosterFilterItemProps) {
  return (
    <SegmentedControlItem
      value={value}
      disabled={disabled}
      className="gap-1 data-pressed:text-text-secondary"
    >
      <span>{label}</span>
      <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-[5px] border border-divider-subtle bg-components-badge-bg-dimm px-1 system-2xs-medium text-text-tertiary">
        {count}
      </span>
    </SegmentedControlItem>
  )
}

export function RosterToolbar({
  draftAgents,
  inUseAgents,
  keyword,
  totalAgents,
  onKeywordChange,
}: RosterToolbarProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label={t('roster.filters.label')}
        value={['all']}
        onValueChange={noop}
      >
        <RosterFilterItem
          value="all"
          label={t('roster.filters.all')}
          count={totalAgents}
        />
        <RosterFilterItem
          value="in-use"
          label={t('roster.filters.inUse')}
          count={inUseAgents}
          disabled
        />
        <RosterFilterItem
          value="drafts"
          label={t('roster.filters.drafts')}
          count={draftAgents}
          disabled
        />
      </SegmentedControl>
      <SearchInput
        aria-label={t('roster.searchLabel')}
        className="h-8 w-50 max-w-full"
        placeholder={t('roster.searchPlaceholder')}
        value={keyword}
        onValueChange={onKeywordChange}
      />
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <CreateAgentDialog />
      </div>
    </div>
  )
}
