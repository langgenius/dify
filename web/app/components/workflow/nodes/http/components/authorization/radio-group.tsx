'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { cn } from '@/utils/classnames'

type Option = {
  value: string
  label: string
}

type ItemProps = {
  title: string
  onClick: () => void
  isSelected: boolean
}
const Item: FC<ItemProps> = ({
  title,
  onClick,
  isSelected,
}) => {
  return (
    <div
      className={cn(
        'system-sm-regular flex h-8 grow cursor-default items-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 text-text-secondary',
        !isSelected && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
        isSelected && 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs',
      )}
      onClick={onClick}
    >
      {title}
    </div>
  )
}

type Props = {
  options: Option[]
  value: string
  onChange: (value: string) => void
}

const RadioGroup: FC<Props> = ({
  options,
  value,
  onChange,
}) => {
  const handleChange = useCallback((value: string) => {
    return () => onChange(value)
  }, [onChange])
  return (
    <div className="flex space-x-2">
      {options.map(option => (
        <Item
          key={option.value}
          title={option.label}
          onClick={handleChange(option.value)}
          isSelected={option.value === value}
        />
      ))}
    </div>
  )
}
export default React.memo(RadioGroup)
