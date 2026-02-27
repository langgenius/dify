'use client'
import type { FC } from 'react'
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { RiCheckLine, RiLoader4Line } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import Badge from '../badge/index'

const defaultItems = [
  { value: 1, name: 'option1' },
  { value: 2, name: 'option2' },
  { value: 3, name: 'option3' },
  { value: 4, name: 'option4' },
  { value: 5, name: 'option5' },
  { value: 6, name: 'option6' },
  { value: 7, name: 'option7' },
]

export type Item = {
  value: number | string
  name: string
  isGroup?: boolean
  disabled?: boolean
  extra?: React.ReactNode
} & Record<string, any>

export type ISelectProps = {
  className?: string
  wrapperClassName?: string
  renderTrigger?: (value: Item | null, isOpen: boolean) => React.JSX.Element | null
  items?: Item[]
  defaultValue?: number | string
  disabled?: boolean
  onSelect: (value: Item) => void
  allowSearch?: boolean
  bgClassName?: string
  placeholder?: string
  overlayClassName?: string
  optionWrapClassName?: string
  optionClassName?: string
  hideChecked?: boolean
  notClearable?: boolean
  renderOption?: ({
    item,
    selected,
  }: {
    item: Item
    selected: boolean
  }) => React.ReactNode
  isLoading?: boolean
  onOpenChange?: (open: boolean) => void
}
const Select: FC<ISelectProps> = ({
  className,
  items = defaultItems,
  defaultValue = 1,
  disabled = false,
  onSelect,
  allowSearch = true,
  bgClassName = 'bg-components-input-bg-normal',
  overlayClassName,
  optionClassName,
  renderOption,
}) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  // Ensure selectedItem is properly set when defaultValue or items change
  useEffect(() => {
    let defaultSelect = null
    // Handle cases where defaultValue might be undefined, null, or empty string
    defaultSelect = (defaultValue && items.find((item: Item) => item.value === defaultValue)) || null
    setSelectedItem(defaultSelect)
  }, [defaultValue, items])

  const filteredItems: Item[]
    = query === ''
      ? items
      : items.filter((item) => {
          return item.name.toLowerCase().includes(query.toLowerCase())
        })

  return (
    <Combobox
      as="div"
      disabled={disabled}
      value={selectedItem}
      className={className}
      onChange={(value: Item) => {
        if (!disabled) {
          setSelectedItem(value)
          setOpen(false)
          onSelect(value)
        }
      }}
    >
      <div className={cn('relative')}>
        <div className="group text-text-secondary">
          {allowSearch
            ? (
                <ComboboxInput
                  className={`w-full rounded-lg border-0 ${bgClassName} py-1.5 pl-3 pr-10 shadow-sm focus-visible:bg-state-base-hover focus-visible:outline-none group-hover:bg-state-base-hover sm:text-sm sm:leading-6 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  onChange={(event) => {
                    if (!disabled)
                      setQuery(event.target.value)
                  }}
                  displayValue={(item: Item) => item?.name}
                />
              )
            : (
                <ComboboxButton
                  onClick={
                    () => {
                      if (!disabled)
                        setOpen(!open)
                    }
                  }
                  className={cn(`flex h-9 w-full items-center rounded-lg border-0 ${bgClassName} py-1.5 pl-3 pr-10 shadow-sm focus-visible:bg-state-base-hover focus-visible:outline-none group-hover:bg-state-base-hover sm:text-sm sm:leading-6`, optionClassName)}
                >
                  <div className="w-0 grow truncate text-left" title={selectedItem?.name}>{selectedItem?.name}</div>
                </ComboboxButton>
              )}
          <ComboboxButton
            className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus:outline-none"
            onClick={
              () => {
                if (!disabled)
                  setOpen(!open)
              }
            }
          >
            {open ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
          </ComboboxButton>
        </div>

        {(filteredItems.length > 0 && open) && (
          <ComboboxOptions className={`absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 py-1 text-base shadow-lg backdrop-blur-sm focus:outline-none sm:text-sm ${overlayClassName}`}>
            {filteredItems.map((item: Item) => (
              <ComboboxOption
                key={item.value}
                value={item}
                className={({ active }: { active: boolean }) =>
                  cn('relative cursor-default select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover', active ? 'bg-state-base-hover' : '', optionClassName)}
              >
                {({ /* active, */ selected }) => (
                  <>
                    {renderOption
                      ? renderOption({ item, selected })
                      : (
                          <>
                            <span className={cn('block', selected && 'font-normal')}>{item.name}</span>
                            {selected && (
                              <span
                                className={cn('absolute inset-y-0 right-0 flex items-center pr-4 text-text-secondary')}
                              >
                                <RiCheckLine className="h-4 w-4" aria-hidden="true" />
                              </span>
                            )}
                          </>
                        )}
                  </>
                )}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        )}
      </div>
    </Combobox>
  )
}

const SimpleSelect: FC<ISelectProps> = ({
  className,
  wrapperClassName = '',
  renderTrigger,
  items = defaultItems,
  defaultValue = 1,
  disabled = false,
  onSelect,
  onOpenChange,
  placeholder,
  optionWrapClassName,
  optionClassName,
  hideChecked,
  notClearable,
  renderOption,
  isLoading = false,
}) => {
  const { t } = useTranslation()
  const localPlaceholder = placeholder || t('placeholder.select', { ns: 'common' })

  const [selectedItem, setSelectedItem] = useState<Item | null>(null)

  // Enhanced: Preserve user selection, only reset when necessary
  useEffect(() => {
    // Only reset if no current selection or current selection is invalid
    const isCurrentSelectionValid = selectedItem && items.some(item => item.value === selectedItem.value)

    if (!isCurrentSelectionValid) {
      let defaultSelect = null
      // Handle cases where defaultValue might be undefined, null, or empty string
      defaultSelect = items.find((item: Item) => item.value === defaultValue) ?? null
      setSelectedItem(defaultSelect)
    }
  }, [defaultValue, items, selectedItem])

  const listboxRef = useRef<HTMLDivElement>(null)

  return (
    <Listbox
      ref={listboxRef}
      value={selectedItem}
      onChange={(value: Item) => {
        if (!disabled) {
          setSelectedItem(value)
          onSelect(value)
        }
      }}
    >
      {({ open }) => (
        <div className={cn('group/simple-select relative h-9', wrapperClassName)}>
          {renderTrigger && <ListboxButton className="w-full">{renderTrigger(selectedItem, open)}</ListboxButton>}
          {!renderTrigger && (
            <ListboxButton
              onClick={() => {
                onOpenChange?.(open)
              }}
              className={cn(`flex h-full w-full items-center rounded-lg border-0 bg-components-input-bg-normal pl-3 pr-10 focus-visible:bg-state-base-hover-alt focus-visible:outline-none group-hover/simple-select:bg-state-base-hover-alt sm:text-sm sm:leading-6 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`, className)}
            >
              <span className={cn('system-sm-regular block truncate text-left text-components-input-text-filled', !selectedItem?.name && 'text-components-input-text-placeholder')}>{selectedItem?.name ?? localPlaceholder}</span>
              <span className="absolute inset-y-0 right-0 flex items-center pr-2">
                {isLoading
                  ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin text-text-secondary" />
                  : (selectedItem && !notClearable)
                      ? (
                          <XMarkIcon
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedItem(null)
                              onSelect({ name: '', value: '' })
                            }}
                            className="h-4 w-4 cursor-pointer text-text-quaternary"
                            aria-hidden="false"
                          />
                        )
                      : (
                          open
                            ? (
                                <ChevronUpIcon
                                  className="h-4 w-4 text-text-quaternary group-hover/simple-select:text-text-secondary"
                                  aria-hidden="true"
                                />
                              )
                            : (
                                <ChevronDownIcon
                                  className="h-4 w-4 text-text-quaternary group-hover/simple-select:text-text-secondary"
                                  aria-hidden="true"
                                />
                              )
                        )}
              </span>
            </ListboxButton>
          )}

          {(!disabled) && (
            <ListboxOptions className={cn('absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 py-1 text-base shadow-lg backdrop-blur-sm focus:outline-none sm:text-sm', optionWrapClassName)}>
              {items.map((item: Item) =>
                item.isGroup ? (
                  <div
                    key={item.value}
                    className="select-none px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary"
                  >
                    {item.name}
                  </div>
                ) : (
                  <ListboxOption
                    key={item.value}
                    className={
                      cn('relative cursor-pointer select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover', optionClassName)
                    }
                    value={item}
                    disabled={item.disabled || disabled}
                  >
                    {({ /* active, */ selected }) => (
                      <>
                        {renderOption
                          ? renderOption({ item, selected })
                          : (
                              <>
                                <span className={cn('block', selected && 'font-normal')}>{item.name}</span>
                                {selected && !hideChecked && (
                                  <span
                                    className={cn('absolute inset-y-0 right-0 flex items-center pr-2 text-text-accent')}
                                  >
                                    <RiCheckLine className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                )}
                              </>
                            )}
                      </>
                    )}
                  </ListboxOption>
                ),
              )}
            </ListboxOptions>
          )}
        </div>
      )}
    </Listbox>
  )
}

type PortalSelectProps = {
  value: string | number
  onSelect: (value: Item) => void
  items: Item[]
  placeholder?: string
  installedValue?: string | number
  renderTrigger?: (value?: Item) => React.JSX.Element | null
  triggerClassName?: string
  triggerClassNameFn?: (open: boolean) => string
  popupClassName?: string
  popupInnerClassName?: string
  readonly?: boolean
  hideChecked?: boolean
}
const PortalSelect: FC<PortalSelectProps> = ({
  value,
  onSelect,
  items,
  placeholder,
  installedValue,
  renderTrigger,
  triggerClassName,
  triggerClassNameFn,
  popupClassName,
  popupInnerClassName,
  readonly,
  hideChecked,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const localPlaceholder = placeholder || t('placeholder.select', { ns: 'common' })
  const selectedItem = value ? items.find(item => item.value === value) : undefined

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
      triggerPopupSameWidth={true}
    >
      <PortalToFollowElemTrigger onClick={() => !readonly && setOpen(v => !v)} className="w-full">
        {renderTrigger
          ? renderTrigger(selectedItem)
          : (
              <div
                className={cn(`
                          group flex h-9 items-center justify-between rounded-lg border-0 bg-components-input-bg-normal px-2.5 text-sm hover:bg-state-base-hover-alt ${readonly ? 'cursor-not-allowed' : 'cursor-pointer'}
                        `, triggerClassName, triggerClassNameFn?.(open))}
                title={selectedItem?.name}
              >
                <span
                  className={`
              grow truncate text-text-secondary
              ${!selectedItem?.name && 'text-components-input-text-placeholder'}
            `}
                >
                  {selectedItem?.name ?? localPlaceholder}
                </span>
                <div className="mx-0.5">
                  {!!(installedValue && selectedItem && selectedItem.value !== installedValue) && (
                    <Badge>
                      {installedValue}
                      {' '}
                      {'->'}
                      {' '}
                      {selectedItem.value}
                      {' '}
                    </Badge>
                  )}
                </div>
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary" />
              </div>
            )}

      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={`z-20 ${popupClassName}`}>
        <div
          className={cn('max-h-60 overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-1 py-1 text-base shadow-lg focus:outline-none sm:text-sm', popupInnerClassName)}
        >
          {items.map((item: Item) => (
            <div
              key={item.value}
              className={`
                flex h-9 cursor-pointer items-center justify-between rounded-lg px-2.5 text-text-secondary hover:bg-state-base-hover
                ${item.value === value && 'bg-state-base-hover'}
              `}
              title={item.name}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              <span
                className="w-0 grow truncate"
                title={item.name}
              >
                <span className="truncate">{item.name}</span>
                {item.value === installedValue && (
                  <Badge uppercase={true} className="ml-1 shrink-0">INSTALLED</Badge>
                )}
              </span>
              {!hideChecked && item.value === value && (
                <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />
              )}
              {item.extra}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export { PortalSelect, SimpleSelect }
export default React.memo(Select)
