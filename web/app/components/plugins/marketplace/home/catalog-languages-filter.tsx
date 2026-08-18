'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import { markMarketplaceSiteFilter } from '@/utils/marketplace-site-track'
import { useFilterTemplateLanguages } from '../atoms'
import { LANGUAGE_OPTIONS } from '../templates/template-language'

export default function CatalogLanguagesFilter() {
  const { t } = useTranslation()
  const [languages, setLanguages] = useFilterTemplateLanguages()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)
  const selectedOptions = LANGUAGE_OPTIONS.filter((option) => languages.includes(option.value))
  const selectedNativeLabels = selectedOptions.map((option) => option.nativeLabel)
  const selectedCount = selectedOptions.length
  const triggerLabel = selectedNativeLabels.length
    ? selectedNativeLabels.join(', ')
    : t(($) => $['marketplace.languages'], { ns: 'plugin' })
  const searchQuery = searchText.toLowerCase()
  const filteredOptions = LANGUAGE_OPTIONS.filter(
    (option) =>
      option.label.toLowerCase().includes(searchQuery) ||
      option.nativeLabel.toLowerCase().includes(searchQuery),
  )

  useEffect(() => {
    if (selectedCount || !shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [selectedCount])

  const handleLanguagesChange = (next: string[]) => {
    const addedLanguage = next.find(language => !languages.includes(language))
    const removedLanguage = languages.find(language => !next.includes(language))
    markMarketplaceSiteFilter({
      filter_type: 'language',
      selection_mode: 'multi',
      filter_value: addedLanguage ?? removedLanguage ?? next.at(-1) ?? '',
      selected_values: next,
    })
    // Server-rendered template results read `languages` from the URL, so this
    // update must notify the App Router instead of only rewriting history.
    setLanguages(next.length ? next : null, { shallow: false })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex h-8 shrink-0 items-center">
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="medium"
              aria-label={triggerLabel}
              className={cn(
                'h-8 justify-start px-2 py-1 text-text-tertiary focus-visible:ring-inset',
                !!selectedCount &&
                  'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg pr-8 shadow-xs shadow-shadow-shadow-3',
                !selectedCount && 'data-popup-open:bg-state-base-hover',
              )}
            >
              <span className="py-0.5">
                <span
                  aria-hidden
                  className={cn(
                    'i-ri-global-line block size-4',
                    !!selectedCount && 'text-text-secondary',
                  )}
                />
              </span>
              <span className="flex items-center gap-x-1 py-1 system-sm-medium">
                {!selectedCount && (
                  <span>{t(($) => $['marketplace.languages'], { ns: 'plugin' })}</span>
                )}
                {!!selectedCount && (
                  <span className="text-text-secondary">
                    {selectedNativeLabels.slice(0, 2).join(',')}
                  </span>
                )}
                {selectedCount > 2 && (
                  <span className="system-xs-medium text-text-tertiary">+{selectedCount - 2}</span>
                )}
              </span>
              {!selectedCount && (
                <span className="py-0.5">
                  <span
                    aria-hidden
                    className="i-ri-arrow-down-s-line block size-4 text-text-tertiary"
                  />
                </span>
              )}
            </Button>
          }
        />
        {!!selectedCount && (
          <IconButton
            variant="ghost"
            size="md"
            aria-label={t(($) => $.clearSearch, {
              ns: 'plugin',
              label: triggerLabel,
            })}
            className="absolute right-1 focus-visible:ring-inset"
            onClick={() => {
              shouldRestoreFocusRef.current = true
              handleLanguagesChange([])
            }}
          >
            <span aria-hidden className="i-ri-close-circle-fill size-4 text-text-quaternary" />
          </IconButton>
        )}
      </div>
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={-6}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <InputGroup>
              <InputGroupInput
                type="search"
                name="language-query"
                autoComplete="off"
                enterKeyHint="search"
                aria-label={t(($) => $['marketplace.searchFilterLanguage'], { ns: 'plugin' }) || ''}
                className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                value={searchText}
                onValueChange={setSearchText}
                placeholder={
                  t(($) => $['marketplace.searchFilterLanguage'], { ns: 'plugin' }) || ''
                }
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
            aria-label={t(($) => $['marketplace.languages'], { ns: 'plugin' })}
            value={languages}
            onValueChange={handleLanguagesChange}
            className="max-h-112 overflow-y-auto p-1"
          >
            {filteredOptions.map((option) => (
              <label
                key={option.value}
                className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
              >
                <Checkbox className="mr-1" value={option.value} />
                <div className="px-1 system-sm-medium text-text-secondary">
                  {option.nativeLabel}
                </div>
              </label>
            ))}
          </CheckboxGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}
