'use client'

import type { RosterFilterValue } from './roster-filter'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { CreateAgentDialog } from './create-agent-dialog'

type RosterToolbarProps = {
  draftAgents: number
  filter: RosterFilterValue
  inUseAgents: number
  keyword: string
  totalAgents: number
  onFilterChange: (value: RosterFilterValue) => void
  onKeywordChange: (value: string) => void
}

type RosterFilterItemProps = {
  count: number
  label: string
  value: RosterFilterValue
}

function RosterFilterItem({
  count,
  label,
  value,
}: RosterFilterItemProps) {
  return (
    <SegmentedControlItem
      value={value}
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
  filter,
  inUseAgents,
  keyword,
  totalAgents,
  onFilterChange,
  onKeywordChange,
}: RosterToolbarProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label={t('roster.filters.label')}
        value={[filter]}
        onValueChange={(value) => {
          const nextFilter = value[0]

          if (nextFilter)
            onFilterChange(nextFilter)
        }}
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
        />
        <RosterFilterItem
          value="drafts"
          label={t('roster.filters.drafts')}
          count={draftAgents}
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
