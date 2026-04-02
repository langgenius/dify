'use client'

import {
  RiArrowDownSLine,
  RiCheckLine,
  RiCloseCircleFill,
} from '@remixicon/react'
import { useState } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

export type FilterOption = {
  value: string
  label: string
}

type FilterChipProps = {
  label: string
  options: FilterOption[]
  value: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
  searchable?: boolean
  searchPlaceholder?: string
}

const FilterChip = ({
  label,
  options,
  value,
  onChange,
  multiple = true,
  searchable = false,
  searchPlaceholder = '',
}: FilterChipProps) => {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  const hasSelected = value.length > 0
  const filteredOptions = searchable
    ? options.filter(option => option.label.toLowerCase().includes(searchText.toLowerCase()))
    : options

  const getSelectedLabels = () => {
    return value
      .map(v => options.find(o => o.value === v)?.label)
      .filter(Boolean)
      .slice(0, 2)
      .join(', ')
  }

  const handleSelect = (optionValue: string) => {
    if (multiple) {
      if (value.includes(optionValue))
        onChange(value.filter(v => v !== optionValue))
      else
        onChange([...value, optionValue])
    }
    else {
      onChange([optionValue])
      setOpen(false)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger
        className="shrink-0"
        onClick={() => setOpen(v => !v)}
      >
        <div className={cn(
          'flex h-8 cursor-pointer select-none items-center gap-0 rounded-lg px-2 py-1',
          !hasSelected && 'bg-components-input-bg-normal text-text-tertiary',
          !hasSelected && open && 'bg-state-base-hover',
          hasSelected && 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3',
        )}
        >
          <div className="flex items-center gap-1 p-1">
            {!hasSelected && (
              <span className="system-sm-regular text-text-tertiary">{label}</span>
            )}
            {hasSelected && (
              <>
                <span className="system-sm-regular text-text-tertiary">{label}</span>
                <span className="system-sm-medium text-text-secondary">
                  {getSelectedLabels()}
                </span>
                {value.length > 2 && (
                  <span className="system-xs-medium text-text-tertiary">
                    +
                    {value.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
          {hasSelected && (
            <RiCloseCircleFill
              className="size-4 shrink-0 text-text-quaternary"
              onClick={handleClear}
            />
          )}
          {!hasSelected && (
            <RiArrowDownSLine className="size-4 shrink-0 text-text-tertiary" />
          )}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
          {searchable && (
            <div className="p-2 pb-1">
              <Input
                showLeftIcon
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          <div className="max-h-[448px] overflow-y-auto p-1">
            {filteredOptions.map(option => (
              <div
                key={option.value}
                className="flex h-7 cursor-pointer select-none items-center rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                onClick={() => handleSelect(option.value)}
              >
                {multiple && (
                  <Checkbox
                    className="mr-1"
                    checked={value.includes(option.value)}
                  />
                )}
                <div className="system-sm-medium flex-1 px-1 text-text-secondary">
                  {option.label}
                </div>
                {!multiple && value.includes(option.value) && (
                  <RiCheckLine className="size-4 text-text-accent" />
                )}
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default FilterChip
