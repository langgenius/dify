'use client'

import type { FC, ReactElement } from 'react'
import type { SelectItem } from './form-input-item.helpers'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCheckLine, RiLoader4Line } from '@remixicon/react'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

type MultiSelectFieldProps = {
  disabled: boolean
  isLoading?: boolean
  items: SelectItem[]
  onChange: (value: string[]) => void
  placeholder?: string
  selectedLabel: string
  value: string[]
}

const LoadingIndicator = () => (
  <RiLoader4Line className="h-3.5 w-3.5 animate-spin text-text-secondary" />
)

const ToggleIndicator = () => (
  <ChevronDownIcon
    className="h-4 w-4 text-text-quaternary group-hover/simple-select:text-text-secondary"
    aria-hidden="true"
  />
)

const SelectedMark = () => (
  <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-text-accent">
    <RiCheckLine className="h-4 w-4" aria-hidden="true" />
  </span>
)

export const MultiSelectField: FC<MultiSelectFieldProps> = ({
  disabled,
  isLoading = false,
  items,
  onChange,
  placeholder,
  selectedLabel,
  value,
}) => {
  const textClassName = cn(
    'block truncate text-left system-sm-regular',
    isLoading
      ? 'text-components-input-text-placeholder'
      : value.length > 0
        ? 'text-components-input-text-filled'
        : 'text-components-input-text-placeholder',
  )

  const renderLabel = () => {
    if (isLoading)
      return 'Loading...'

    return selectedLabel || placeholder || 'Select options'
  }

  return (
    <Listbox multiple value={value} onChange={onChange} disabled={disabled}>
      <div className="group/simple-select relative h-8 grow">
        <ListboxButton className="flex h-full w-full cursor-pointer items-center rounded-lg border-0 bg-components-input-bg-normal pr-10 pl-3 group-hover/simple-select:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:outline-hidden sm:text-sm sm:leading-6">
          <span className={textClassName}>
            {renderLabel()}
          </span>
          <span className="absolute inset-y-0 right-0 flex items-center pr-2">
            {isLoading ? <LoadingIndicator /> : <ToggleIndicator />}
          </span>
        </ListboxButton>
        <ListboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 py-1 text-base shadow-lg backdrop-blur-xs focus:outline-hidden sm:text-sm">
          {items.map(item => (
            <ListboxOption
              key={item.value}
              value={item.value}
              className={({ focus }) =>
                cn('relative cursor-pointer rounded-lg py-2 pr-9 pl-3 text-text-secondary select-none hover:bg-state-base-hover', focus && 'bg-state-base-hover')}
            >
              {({ selected }) => (
                <>
                  <div className="flex items-center">
                    {item.icon && (
                      <img src={item.icon} alt="" className="mr-2 h-4 w-4" />
                    )}
                    <span className={cn('block truncate', selected && 'font-normal')}>
                      {item.name}
                    </span>
                  </div>
                  {selected && <SelectedMark />}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}

type JsonEditorFieldProps = {
  onChange: (value: string) => void
  placeholder?: ReactElement | string
  value: string
}

export const JsonEditorField: FC<JsonEditorFieldProps> = ({
  onChange,
  placeholder,
  value,
}) => {
  return (
    <div className="mt-1 w-full">
      <CodeEditor
        title="JSON"
        value={value}
        isExpand
        isInNode
        language={CodeLanguage.json}
        onChange={onChange}
        className="w-full"
        placeholder={placeholder}
      />
    </div>
  )
}
