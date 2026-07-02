'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { rosterQueryParamNames, rosterSortByQueryParser } from '../query-params'
import { DEFAULT_ROSTER_SORT_BY, rosterSortOptions } from './roster-sort'

export function RosterSortSelect() {
  const { t } = useTranslation('agentV2')
  const [value, setValue] = useQueryState(rosterQueryParamNames.sortBy, rosterSortByQueryParser)
  const selectedOption = rosterSortOptions.find(option => option.value === value)
    ?? rosterSortOptions.find(option => option.value === DEFAULT_ROSTER_SORT_BY)!

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        void setValue(nextValue)
      }}
    >
      <SelectTrigger
        aria-label={t('roster.sort.label')}
        className="h-8 w-fit max-w-full shrink-0 gap-0 py-1 pr-2.5 pl-2"
      >
        <span className="flex min-w-0 items-center gap-1 px-1">
          <span className="shrink-0 system-sm-regular text-text-tertiary">
            {t('roster.sort.label')}
          </span>
          <span className="truncate system-sm-medium text-text-secondary">
            {t(selectedOption.labelKey)}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-60"
        listProps={{ 'aria-label': t('roster.sort.optionsLabel') }}
      >
        {rosterSortOptions.map(option => (
          <SelectItem
            key={option.value}
            value={option.value}
          >
            <SelectItemText title={t(option.labelKey)}>{t(option.labelKey)}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
