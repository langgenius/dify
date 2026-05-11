'use client'

import type { FC, ReactElement } from 'react'
import type { SelectItem } from './form-input-item.helpers'
import { cn } from '@langgenius/dify-ui/cn'
import {
  SelectItem as DifySelectItem,
  Select,
  SelectContent,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { RiLoader4Line } from '@remixicon/react'
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
  <RiLoader4Line className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin text-text-secondary motion-reduce:animate-none" aria-hidden="true" />
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
      return 'Loading…'

    return selectedLabel || placeholder || 'Select options'
  }

  return (
    <Select multiple value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <div className="grow">
        <SelectTrigger aria-label={placeholder || selectedLabel || 'Options'}>
          <span className={cn('flex min-w-0 items-center', textClassName)}>
            {isLoading && <LoadingIndicator />}
            {renderLabel()}
          </span>
        </SelectTrigger>
        <SelectContent
          popupClassName="w-(--anchor-width) bg-components-panel-bg-blur backdrop-blur-xs"
          listClassName="max-h-60"
        >
          {items.map(item => (
            <DifySelectItem
              key={item.value}
              value={item.value}
              className="h-auto py-2 pr-9 pl-3"
            >
              <div className="flex min-w-0 items-center">
                {item.icon && (
                  <img src={item.icon} alt="" width={16} height={16} className="mr-2 h-4 w-4 shrink-0" />
                )}
                <SelectItemText>
                  {item.name}
                </SelectItemText>
              </div>
              <SelectItemIndicator />
            </DifySelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
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
