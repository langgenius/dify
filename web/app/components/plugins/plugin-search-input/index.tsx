'use client'

import type { Ref } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { useTranslation } from 'react-i18next'
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
  const { inputProps, clear } = useSearchInput({ value, onValueChange, ref })

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...inputProps}
        type="search"
        name="query"
        autoComplete="off"
        enterKeyHint="search"
        aria-label={placeholder}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Picker owners request focus when replacing an already-focused menu.
        autoFocus={autoFocus}
        className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      <InputGroupAddon className="ps-1.75 pe-1.25">
        <span
          aria-hidden
          className="i-ri-search-line size-4 text-components-input-text-placeholder"
        />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end" className="gap-1 ps-0.75 pe-0.5">
        {!!inputProps.value && (
          <IconButton
            size="sm"
            aria-label={t(($) => $.clearSearch, { ns: 'plugin', label: placeholder })}
            className="text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
            onClick={clear}
          >
            <span aria-hidden className="i-ri-close-circle-fill size-4" />
          </IconButton>
        )}
        <Separator decorative orientation="vertical" className="mx-0 h-3.5" />
        <PluginTagsFilter value={tags} onValueChange={onTagsChange} />
      </InputGroupAddon>
    </InputGroup>
  )
}
