'use client'

import type { DatasetAvailabilityFilter } from './availability'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type AvailabilityFilterProps = {
  value: DatasetAvailabilityFilter
  onChange: (value: DatasetAvailabilityFilter) => void
}

const chipClassName =
  'flex h-8 items-center rounded-lg border-[0.5px] px-2 text-[13px] leading-4 transition-colors'

const AvailabilityFilter = ({ value, onChange }: AvailabilityFilterProps) => {
  const { t } = useTranslation(['dataset'])

  const options = useMemo(
    () =>
      [
        { value: 'all', text: t(($) => $['availabilityFilter.all']) },
        { value: 'available', text: t(($) => $['availabilityFilter.available']) },
        { value: 'unavailable', text: t(($) => $.unavailable) },
      ] satisfies Array<{ value: DatasetAvailabilityFilter; text: string }>,
    [t],
  )

  const isSelected = value !== 'all'
  const activeOption = options.find((option) => option.value === value)
  const triggerLabel = isSelected ? activeOption?.text : t(($) => $['availabilityFilter.label'])

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className={cn(
              chipClassName,
              isSelected
                ? 'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs hover:bg-state-base-hover'
                : 'border-transparent bg-components-input-bg-normal text-text-tertiary hover:bg-components-input-bg-hover',
            )}
          />
        }
      >
        <span className="px-1 text-text-tertiary">{triggerLabel}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary" />
      </MenuTrigger>
      <MenuContent align="start" className="w-55">
        <MenuRadioGroup<DatasetAvailabilityFilter>
          value={value}
          onValueChange={(nextValue) => onChange(nextValue)}
        >
          {options.map((option) => (
            <MenuRadioItem<DatasetAvailabilityFilter>
              key={option.value}
              value={option.value}
              closeOnClick
            >
              <span>{option.text}</span>
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default AvailabilityFilter
