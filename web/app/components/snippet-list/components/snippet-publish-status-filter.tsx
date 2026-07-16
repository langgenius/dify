'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type SnippetPublishStatus = 'all' | 'published' | 'draft'

type SnippetPublishStatusFilterProps = {
  value: SnippetPublishStatus
  onChange: (value: SnippetPublishStatus) => void
}

const chipClassName =
  'flex h-8 items-center rounded-lg border-[0.5px] px-2 text-[13px] leading-4 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const snippetPublishStatusValues: SnippetPublishStatus[] = ['all', 'published', 'draft']

const isSnippetPublishStatus = (value: string): value is SnippetPublishStatus => {
  return snippetPublishStatusValues.includes(value as SnippetPublishStatus)
}

const SnippetPublishStatusFilter = ({ value, onChange }: SnippetPublishStatusFilterProps) => {
  const { t } = useTranslation()

  const options = useMemo(
    () =>
      [
        { value: 'all', text: t(($) => $['types.all'], { ns: 'app' }) },
        { value: 'published', text: t(($) => $['common.published'], { ns: 'workflow' }) },
        { value: 'draft', text: t(($) => $.draft, { ns: 'snippet' }) },
      ] satisfies Array<{ value: SnippetPublishStatus; text: string }>,
    [t],
  )

  const activeOption = options.find((option) => option.value === value)
  const isSelected = value !== 'all'
  const defaultLabel = `${t(($) => $['common.published'], { ns: 'workflow' })} / ${t(($) => $.draft, { ns: 'snippet' })}`
  const triggerLabel = isSelected ? activeOption?.text : defaultLabel

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
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
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-[220px]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => isSnippetPublishStatus(nextValue) && onChange(nextValue)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span>{option.text}</span>
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default SnippetPublishStatusFilter
