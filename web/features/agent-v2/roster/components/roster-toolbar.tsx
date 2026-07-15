'use client'

import type { RosterFilterValue } from './roster-filter'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import {
  rosterCreatedByMeQueryParser,
  rosterFilterQueryParser,
  rosterKeywordQueryParser,
  rosterQueryParamNames,
} from '../query-params'
import { CreateAgentDialog } from './create-agent-dialog'
import { RosterSortSelect } from './roster-sort-select'

type RosterToolbarProps = {
  draftAgents: number
  publishedAgents: number
}

type RosterFilterItemProps = {
  count?: number
  label: string
  value: RosterFilterValue
}

function RosterFilterItem({ count, label, value }: RosterFilterItemProps) {
  return (
    <SegmentedControlItem value={value} className="gap-1 data-pressed:text-text-secondary">
      <span>{label}</span>
      {count !== undefined && (
        <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
          <span className="min-w-px flex-1 text-center">{count}</span>
        </span>
      )}
    </SegmentedControlItem>
  )
}

function RosterStatusFilter({ draftAgents, publishedAgents }: RosterToolbarProps) {
  const { t } = useTranslation('agentV2')
  const [filter, setFilter] = useQueryState(rosterQueryParamNames.filter, rosterFilterQueryParser)

  return (
    <SegmentedControl
      aria-label={t(($) => $['roster.filters.label'])}
      className="shrink-0"
      value={[filter]}
      onValueChange={(value) => {
        const nextFilter = value[0]

        if (nextFilter) void setFilter(nextFilter)
      }}
    >
      <RosterFilterItem value="all" label={t(($) => $['roster.filters.all'])} />
      <RosterFilterItem
        value="published"
        label={t(($) => $['roster.filters.published'])}
        count={publishedAgents}
      />
      <RosterFilterItem
        value="drafts"
        label={t(($) => $['roster.filters.drafts'])}
        count={draftAgents}
      />
    </SegmentedControl>
  )
}

function RosterSearchFilter() {
  const { t } = useTranslation('agentV2')
  const [keyword, setKeyword] = useQueryState(
    rosterQueryParamNames.keyword,
    rosterKeywordQueryParser,
  )

  return (
    <SearchInput
      aria-label={t(($) => $['roster.searchLabel'])}
      className="h-8 w-50 min-w-0 shrink"
      placeholder={t(($) => $['roster.searchPlaceholder'])}
      value={keyword}
      onValueChange={(value) => {
        void setKeyword(value)
      }}
    />
  )
}

function RosterCreatedByMeFilter() {
  const { t } = useTranslation('agentV2')
  const [createdByMe, setCreatedByMe] = useQueryState(
    rosterQueryParamNames.createdByMe,
    rosterCreatedByMeQueryParser,
  )

  return (
    <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 whitespace-nowrap">
      <Checkbox
        checked={createdByMe}
        onCheckedChange={(checked) => {
          void setCreatedByMe(checked === true)
        }}
      />
      <span className="p-1 system-sm-regular text-text-tertiary">
        {t(($) => $['roster.filters.createdByMe'])}
      </span>
    </label>
  )
}

export function RosterToolbar({ draftAgents, publishedAgents }: RosterToolbarProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <RosterStatusFilter draftAgents={draftAgents} publishedAgents={publishedAgents} />
      <RosterSearchFilter />
      <div className="flex h-4 shrink-0 px-1" aria-hidden="true">
        <div className="h-full w-px bg-divider-regular" />
      </div>
      <RosterCreatedByMeFilter />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <RosterSortSelect />
        <CreateAgentDialog />
      </div>
    </div>
  )
}
