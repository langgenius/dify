'use client'

import type { AppListUrlQuery } from './query-params'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { studioAppListCategories } from './query-params'

type AppListCategory = AppListUrlQuery['category']

type AppTypeFilterProps = {
  value: AppListCategory
  onValueChange: (value: AppListCategory) => void
}

export function AppTypeFilter({ value, onValueChange }: AppTypeFilterProps) {
  const { t } = useTranslation(['app'])

  const options = useMemo(() => {
    const optionsByCategory = {
      all: {
        label: t(($) => $['types.all'], { ns: 'app' }),
        iconClassName: 'i-ri-apps-2-line',
      },
      workflow: {
        label: t(($) => $['types.workflow'], { ns: 'app' }),
        iconClassName: 'i-ri-exchange-2-line',
      },
      'advanced-chat': {
        label: t(($) => $['types.advanced'], { ns: 'app' }),
        iconClassName: 'i-ri-message-3-line',
      },
      chat: {
        label: t(($) => $['types.chatbot'], { ns: 'app' }),
        iconClassName: 'i-ri-message-3-line',
      },
      'agent-chat': {
        label: t(($) => $['types.agent'], { ns: 'app' }),
        iconClassName: 'i-ri-robot-3-line',
      },
      completion: {
        label: t(($) => $['newApp.completeApp'], { ns: 'app' }),
        iconClassName: 'i-ri-file-4-line',
      },
    } satisfies Record<AppListCategory, { label: string; iconClassName: string }>

    return studioAppListCategories.map((value) => ({
      value,
      ...optionsByCategory[value],
    }))
  }, [t])

  const isFiltered = value !== 'all'
  const typesLabel = t(($) => $['studio.filters.types'], { ns: 'app' })

  return (
    <Select<AppListCategory>
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue)
      }}
    >
      <SelectTrigger aria-label={typesLabel} className="w-auto">
        <SelectValue className="text-text-tertiary">
          {isFiltered ? undefined : typesLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="w-55">
        {options.map((option) => (
          <SelectItem<AppListCategory> key={option.value} value={option.value} className="gap-1">
            <span
              aria-hidden
              className={cn('h-4 w-4 shrink-0 text-text-tertiary', option.iconClassName)}
            />
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
