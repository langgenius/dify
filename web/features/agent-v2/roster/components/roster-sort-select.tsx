'use client'

import type { inferParserType } from 'nuqs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useQueryState } from 'nuqs'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { rosterQueryParamNames, rosterSortByQueryParser } from '../query-params'

type RosterSortBy = inferParserType<typeof rosterSortByQueryParser>

export function RosterSortSelect() {
  const { t } = useTranslation(['agentRoster'])
  const sortLabelId = useId()
  const [value, setValue] = useQueryState(rosterQueryParamNames.sortBy, rosterSortByQueryParser)
  const options = [
    {
      value: 'last_modified',
      label: t(($) => $['roster.sort.lastModified'], { ns: 'agentRoster' }),
    },
    {
      value: 'recently_created',
      label: t(($) => $['roster.sort.recentlyCreated'], { ns: 'agentRoster' }),
    },
    {
      value: 'earliest_created',
      label: t(($) => $['roster.sort.earliestCreated'], { ns: 'agentRoster' }),
    },
  ] satisfies Array<{ value: RosterSortBy; label: string }>
  const sortByLabel = t(($) => $['roster.sort.label'], { ns: 'agentRoster' })

  return (
    <Select<RosterSortBy>
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) void setValue(nextValue)
      }}
    >
      <SelectTrigger aria-labelledby={sortLabelId} className="w-auto max-w-45 min-w-0">
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          {/* aria-labelledby names the control; exclude this prefix from its accessible value. */}
          <span
            id={sortLabelId}
            aria-hidden="true"
            className="shrink-0 font-normal text-text-tertiary"
          >
            {sortByLabel}
          </span>{' '}
          <SelectValue className="min-w-0 truncate font-medium text-text-secondary" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem<RosterSortBy> key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
