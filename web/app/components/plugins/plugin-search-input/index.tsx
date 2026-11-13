'use client'

import type { Ref } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { useTranslation } from 'react-i18next'
import { SearchInputClear } from '@/app/components/base/search-input'
import { useSearchInput } from '@/app/components/base/search-input/use-search-input'
import { PluginTagsFilter } from '../plugin-tags-filter'

type PluginSearchInputProps = {
  ref?: Ref<HTMLInputElement>
  value: string
  onValueChange: (value: string) => void
  tags: string[]
  onTagsChange: (tags: string[]) => void
  placeholder: string
  className?: string
  autoFocus?: boolean
}

export function PluginSearchInput({
  ref,
  value,
  onValueChange,
  tags,
  onTagsChange,
  placeholder,
  className,
  autoFocus,
}: PluginSearchInputProps) {
  const { t } = useTranslation(['plugin'])
  const { inputProps, canClear, clearProps } = useSearchInput({ value, onValueChange, ref })

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...inputProps}
        name="query"
        autoComplete="off"
        enterKeyHint="search"
        aria-label={placeholder}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Picker owners request focus when replacing an already-focused menu.
        autoFocus={autoFocus}
      />
      <InputGroupAddon className="ps-1.75 pe-1.25">
        <span
          aria-hidden
          className="i-ri-search-line size-4 text-components-input-text-placeholder"
        />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end" className="gap-1 ps-0.75 pe-0.5">
        {canClear && (
          <SearchInputClear
            {...clearProps}
            aria-label={t(($) => $.clearSearch, { ns: 'plugin', label: placeholder })}
          />
        )}
        <Separator decorative orientation="vertical" className="mx-0 h-3.5" />
        <PluginTagsFilter value={tags} onValueChange={onTagsChange} />
      </InputGroupAddon>
    </InputGroup>
  )
}
