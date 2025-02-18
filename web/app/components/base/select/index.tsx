'use client'
import type { FC } from 'react'
import React, { Fragment, useEffect, useState } from 'react'
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/20/solid'
import Badge from '../badge/index'
import { RiCheckLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import classNames from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

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
} & Record<string, any>

export type ISelectProps = {
  className?: string
  wrapperClassName?: string
  renderTrigger?: (value: Item | null) => React.JSX.Element | null
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
  useEffect(() => {
    let defaultSelect = null
    const existed = items.find((item: Item) => item.value === defaultValue)
    if (existed)
      defaultSelect = existed

    setSelectedItem(defaultSelect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue])

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
      }}>
      <div className={classNames('relative')}>
        <div className='text-text-secondary group'>
          {allowSearch
            ? <ComboboxInput
              className={`w-full rounded-lg border-0 ${bgClassName} focus-visible:bg-state-base-hover group-hover:bg-state-base-hover py-1.5 pl-3 pr-10 shadow-sm focus-visible:outline-none sm:text-sm sm:leading-6 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              onChange={(event) => {
                if (!disabled)
                  setQuery(event.target.value)
              }}
              displayValue={(item: Item) => item?.name}
            />
            : <ComboboxButton onClick={
              () => {
                if (!disabled)
                  setOpen(!open)
              }
            } className={classNames(`flex items-center h-9 w-full rounded-lg border-0 ${bgClassName} py-1.5 pl-3 pr-10 shadow-sm sm:text-sm sm:leading-6 focus-visible:outline-none focus-visible:bg-state-base-hover group-hover:bg-state-base-hover`, optionClassName)}>
              <div className='w-0 grow truncate text-left' title={selectedItem?.name}>{selectedItem?.name}</div>
            </ComboboxButton>}
          <ComboboxButton className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus:outline-none" onClick={
            () => {
              if (!disabled)
                setOpen(!open)
            }
          }>
            {open ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
          </ComboboxButton>
        </div>

        {(filteredItems.length > 0 && open) && (
          <ComboboxOptions className={`bg-components-panel-bg-blur border-components-panel-border absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border-[0.5px] px-1 py-1 text-base shadow-lg backdrop-blur-sm focus:outline-none sm:text-sm ${overlayClassName}`}>
            {filteredItems.map((item: Item) => (
              <ComboboxOption
                key={item.value}
                value={item}
                className={({ active }: { active: boolean }) =>
                  classNames(
                    'relative cursor-default select-none py-2 pl-3 pr-9 rounded-lg hover:bg-state-base-hover text-text-secondary',
                    active ? 'bg-state-base-hover' : '',
                    optionClassName,
                  )
                }
              >
                {({ /* active, */ selected }) => (
                  <>
                    {renderOption
                      ? renderOption({ item, selected })
                      : (
                        <>
                          <span className={classNames('block', selected && 'font-normal')}>{item.name}</span>
                          {selected && (
                            <span
                              className={classNames(
                                'absolute inset-y-0 right-0 flex items-center pr-4 text-text-secondary',
                              )}
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
    </Combobox >
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
  placeholder,
  optionWrapClassName,
  optionClassName,
  hideChecked,
  notClearable,
  renderOption,
}) => {
  const { t } = useTranslation()
  const localPlaceholder = placeholder || t('common.placeholder.select')

  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  useEffect(() => {
    let defaultSelect = null
    const existed = items.find((item: Item) => item.value === defaultValue)
    if (existed)
      defaultSelect = existed

    setSelectedItem(defaultSelect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue])

  return (
    <Listbox
      value={selectedItem}
      onChange={(value: Item) => {
        if (!disabled) {
          setSelectedItem(value)
          onSelect(value)
        }
      }}
    >
      <div className={classNames('group/simple-select relative h-9', wrapperClassName)}>
        {renderTrigger && <ListboxButton className='w-full'>{renderTrigger(selectedItem)}</ListboxButton>}
        {!renderTrigger && (
          <ListboxButton className={classNames(`flex items-center w-full h-full rounded-lg border-0 bg-components-input-bg-normal pl-3 pr-10 sm:text-sm sm:leading-6 focus-visible:outline-none focus-visible:bg-state-base-hover-alt group-hover/simple-select:bg-state-base-hover-alt ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`, className)}>
            <span className={classNames('block truncate text-left system-sm-regular text-components-input-text-filled', !selectedItem?.name && 'text-components-input-text-placeholder')}>{selectedItem?.name ?? localPlaceholder}</span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-2">
              {(selectedItem && !notClearable)
                ? (
                  <XMarkIcon
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedItem(null)
                      onSelect({ name: '', value: '' })
                    }}
                    className="text-text-quaternary h-4 w-4 cursor-pointer"
                    aria-hidden="false"
                  />
                )
                : (
                  <ChevronDownIcon
                    className="text-text-quaternary group-hover/simple-select:text-text-secondary h-4 w-4"
                    aria-hidden="true"
                  />
                )}
            </span>
          </ListboxButton>
        )}

        {!disabled && (
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >

            <ListboxOptions className={classNames('absolute z-10 mt-1 px-1 max-h-60 w-full overflow-auto rounded-md bg-components-panel-bg-blur backdrop-blur-sm py-1 text-base shadow-lg border-components-panel-border border-[0.5px] focus:outline-none sm:text-sm', optionWrapClassName)}>
              {items.map((item: Item) => (
                <ListboxOption
                  key={item.value}
                  className={
                    classNames(
                      'relative cursor-pointer select-none py-2 pl-3 pr-9 rounded-lg hover:bg-state-base-hover text-text-secondary',
                      optionClassName,
                    )
                  }
                  value={item}
                  disabled={disabled}
                >
                  {({ /* active, */ selected }) => (
                    <>
                      {renderOption
                        ? renderOption({ item, selected })
                        : (<>
                          <span className={classNames('block', selected && 'font-normal')}>{item.name}</span>
                          {selected && !hideChecked && (
                            <span
                              className={classNames(
                                'absolute inset-y-0 right-0 flex items-center pr-4 text-text-accent',
                              )}
                            >
                              <RiCheckLine className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                        </>)}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Transition >
        )}
      </div >
    </Listbox >
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
  const localPlaceholder = placeholder || t('common.placeholder.select')
  const selectedItem = value ? items.find(item => item.value === value) : undefined

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => !readonly && setOpen(v => !v)} className='w-full'>
        {renderTrigger
          ? renderTrigger(selectedItem)
          : (
            <div
              className={classNames(`
            group flex items-center justify-between px-2.5 h-9 rounded-lg border-0 bg-components-input-bg-normal hover:bg-state-base-hover-alt text-sm ${readonly ? 'cursor-not-allowed' : 'cursor-pointer'} 
          `, triggerClassName, triggerClassNameFn?.(open))}
              title={selectedItem?.name}
            >
              <span
                className={`
              grow truncate
              ${!selectedItem?.name && 'text-components-input-text-placeholder'}
            `}
              >
                {selectedItem?.name ?? localPlaceholder}
              </span>
              <div className='mx-0.5'>{installedValue && selectedItem && selectedItem.value !== installedValue && <Badge>{installedValue} {'->'} {selectedItem.value} </Badge>}</div>
              <ChevronDownIcon className='text-text-quaternary group-hover:text-text-secondary h-4 w-4 shrink-0' />
            </div>
          )}

      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={`z-20 ${popupClassName}`}>
        <div
          className={classNames('px-1 py-1 max-h-60 overflow-auto rounded-md text-base shadow-lg border-components-panel-border bg-components-panel-bg border-[0.5px] focus:outline-none sm:text-sm', popupInnerClassName)}
        >
          {items.map((item: Item) => (
            <div
              key={item.value}
              className={`
                hover:bg-state-base-hover text-text-secondary flex h-9 cursor-pointer items-center justify-between rounded-lg px-2.5
                ${item.value === value && 'bg-state-base-hover'}
              `}
              title={item.name}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              <span
                className='w-0 grow truncate'
                title={item.name}
              >
                <span className='truncate'>{item.name}</span>
                {item.value === installedValue && (
                  <Badge uppercase={true} className='ml-1 shrink-0'>INSTALLED</Badge>
                )}
              </span>
              {!hideChecked && item.value === value && (
                <RiCheckLine className='text-text-accent h-4 w-4 shrink-0' />
              )}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export { SimpleSelect, PortalSelect }
export default React.memo(Select)
