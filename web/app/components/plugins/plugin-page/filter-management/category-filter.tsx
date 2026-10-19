'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine, RiCloseCircleFill } from '@remixicon/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCategories } from '../../hooks'

type CategoriesFilterProps = {
  value: string[]
  onChange: (categories: string[]) => void
}
const CategoriesFilter = ({ value, onChange }: CategoriesFilterProps) => {
  const { t } = useTranslation(['plugin'])
  const [searchText, setSearchText] = useState('')
  const searchLabel = t(($) => $.searchCategories, { ns: 'plugin' })
  const { categories: options, categoriesMap } = useCategories()
  const filteredOptions = options.filter((option) =>
    option.name.toLowerCase().includes(searchText.toLowerCase()),
  )
  const selectedTagsLength = value.length
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)

  useEffect(() => {
    if (selectedTagsLength || !shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [selectedTagsLength])

  return (
    <Popover>
      <div className="relative inline-flex h-8 items-center">
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="medium"
              className={cn(
                'h-8 rounded-lg bg-components-input-bg-normal px-2 py-1 text-text-tertiary hover:bg-state-base-hover-alt focus-visible:ring-inset',
                selectedTagsLength && 'pr-8 text-text-secondary',
                'data-popup-open:bg-state-base-hover',
              )}
            >
              <span className="flex items-center p-1 system-sm-medium">
                {!selectedTagsLength && t(($) => $.allCategories, { ns: 'plugin' })}
                {!!selectedTagsLength &&
                  value
                    .map((val) => categoriesMap[val]!.label)
                    .slice(0, 2)
                    .join(',')}
                {selectedTagsLength > 2 && (
                  <span className="ml-1 system-xs-medium text-text-tertiary">
                    +{selectedTagsLength - 2}
                  </span>
                )}
              </span>
              {!selectedTagsLength && <RiArrowDownSLine aria-hidden="true" className="size-4" />}
            </Button>
          }
        />
        {!!selectedTagsLength && (
          <IconButton
            variant="ghost"
            size="md"
            aria-label={t(($) => $.clearSearch, {
              ns: 'plugin',
              label: t(($) => $.allCategories, { ns: 'plugin' }),
            })}
            className="absolute right-1 focus-visible:ring-inset"
            onClick={() => {
              shouldRestoreFocusRef.current = true
              onChange([])
            }}
          >
            <RiCloseCircleFill aria-hidden="true" className="size-4 text-text-quaternary" />
          </IconButton>
        )}
      </div>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        className="border-none bg-transparent shadow-none"
      >
        <div className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <InputGroup>
              <InputGroupInput
                type="search"
                aria-label={searchLabel}
                autoComplete="off"
                className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                placeholder={searchLabel}
                value={searchText}
                onValueChange={setSearchText}
              />
              <InputGroupAddon className="ps-2 pe-0.5">
                <span
                  aria-hidden="true"
                  className="i-ri-search-line size-4 text-components-input-text-placeholder"
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <CheckboxGroup
            aria-label={t(($) => $.allCategories, { ns: 'plugin' })}
            value={value}
            onValueChange={(nextValue) => onChange(nextValue)}
            className="max-h-112 overflow-y-auto p-1"
          >
            {filteredOptions.map((option) => (
              <label
                key={option.name}
                className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
              >
                <Checkbox className="mr-1" value={option.name} />
                <div className="px-1 system-sm-medium text-text-secondary">{option.label}</div>
              </label>
            ))}
          </CheckboxGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default CategoriesFilter
