'use client'

import type { RosterFilterValue } from './roster-filter'
import type { RosterSortBy } from './roster-sort'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { CreateAgentDialog } from './create-agent-dialog'
import { RosterSortSelect } from './roster-sort-select'

type RosterToolbarProps = {
  createdByMe: boolean
  draftAgents: number
  filter: RosterFilterValue
  keyword: string
  sortBy: RosterSortBy
  onCreatedByMeChange: (value: boolean) => void
  onFilterChange: (value: RosterFilterValue) => void
  onKeywordChange: (value: string) => void
  onSortByChange: (value: RosterSortBy) => void
  publishedAgents: number
}

type RosterFilterItemProps = {
  count?: number
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
      {count !== undefined && (
        <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
          <span className="min-w-px flex-1 text-center">
            {count}
          </span>
        </span>
      )}
    </SegmentedControlItem>
  )
}

export function RosterToolbar({
  createdByMe,
  draftAgents,
  filter,
  keyword,
  sortBy,
  onCreatedByMeChange,
  onFilterChange,
  onKeywordChange,
  onSortByChange,
  publishedAgents,
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
        />
        <RosterFilterItem
          value="published"
          label={t('roster.filters.published')}
          count={publishedAgents}
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
      <div className="flex h-4 shrink-0 px-1" aria-hidden="true">
        <div className="h-full w-px bg-divider-regular" />
      </div>
      <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1">
        <Checkbox
          checked={createdByMe}
          onCheckedChange={checked => onCreatedByMeChange(checked === true)}
        />
        <span className="p-1 system-sm-regular text-text-tertiary">{t('roster.filters.createdByMe')}</span>
      </label>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <RosterSortSelect
          value={sortBy}
          onValueChange={onSortByChange}
        />
        <CreateAgentDialog />
      </div>
    </div>
  )
}
