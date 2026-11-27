'use client'

import type { PopoverPortalProps } from '@langgenius/dify-ui/popover'
import type { ReactNode } from 'react'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'

type TagFilterPopoverProps = {
  options: { name: string; label: string }[]
  value: string[]
  onValueChange: (value: string[]) => void
  label: string
  searchLabel: string
  emptyText?: string
  /** A failed load of the options, shown in place of the empty text. */
  loadError?: ReactNode
  container?: PopoverPortalProps['container']
  children: ReactNode
}

export function TagFilterPopover({
  options,
  value,
  onValueChange,
  label,
  searchLabel,
  emptyText,
  loadError,
  container,
  children,
}: TagFilterPopoverProps) {
  const [searchText, setSearchText] = useState('')
  const filteredOptions = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()),
  )

  return (
    <Popover>
      {children}
      <PopoverPortal container={container}>
        <PopoverPositioner align="start" sideOffset={4} alignOffset={-6}>
          <PopoverPopup
            aria-label={label}
            className="flex max-h-(--available-height) w-60 max-w-(--available-width) flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs"
          >
            <div className="p-2 pb-1">
              <InputGroup>
                <InputGroupInput
                  type="search"
                  name="tag-query"
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label={searchLabel}
                  className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                  value={searchText}
                  onValueChange={setSearchText}
                  placeholder={searchLabel}
                />
                <InputGroupAddon className="ps-1.75 pe-0.75">
                  <span
                    aria-hidden
                    className="i-ri-search-line size-4 text-components-input-text-placeholder"
                  />
                </InputGroupAddon>
              </InputGroup>
            </div>
            <CheckboxGroup
              aria-label={label}
              value={value}
              onValueChange={(tags) => onValueChange(tags)}
              className="max-h-112 min-h-0 overflow-y-auto overscroll-contain p-1"
            >
              {filteredOptions.map((option) => (
                <label
                  key={option.name}
                  className="flex min-h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
                >
                  <Checkbox className="me-1" value={option.name} />
                  <span className="min-w-0 px-1 system-sm-medium wrap-anywhere text-text-secondary">
                    {option.label}
                  </span>
                </label>
              ))}
            </CheckboxGroup>

            {loadError}
            {!loadError && emptyText && !filteredOptions.length && (
              <div className="p-3 text-center system-xs-regular text-text-tertiary">
                {emptyText}
              </div>
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
