'use client'

import type { FC } from 'react'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine, RiArrowRightSLine, RiCheckLine, RiLoader4Line } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  disabled?: boolean
  isLoading?: boolean
  language: string
  onChange: (value: string) => void
  options: FormOption[]
  placeholder?: string
  value?: string
}

type TreeOption = FormOption & {
  children?: TreeOption[]
}

const getOptionLabel = (option: TreeOption, language: string) => {
  return option.label?.[language] || option.label?.en_US || option.value
}

const findNodeByValue = (options: TreeOption[], value?: string): TreeOption | undefined => {
  if (!value)
    return undefined
  for (const option of options) {
    if (option.value === value)
      return option
    if (option.children?.length) {
      const target = findNodeByValue(option.children, value)
      if (target)
        return target
    }
  }
  return undefined
}

const collectExpandableValues = (options: TreeOption[]): string[] => {
  const values: string[] = []
  for (const option of options) {
    if (option.children?.length) {
      values.push(option.value)
      values.push(...collectExpandableValues(option.children))
    }
  }
  return values
}

type TreeNodeProps = {
  expandedValues: Set<string>
  language: string
  level: number
  onSelect: (value: string) => void
  option: TreeOption
  selectedValue?: string
  toggleExpand: (value: string) => void
}

const TreeNode: FC<TreeNodeProps> = ({
  expandedValues,
  language,
  level,
  onSelect,
  option,
  selectedValue,
  toggleExpand,
}) => {
  const hasChildren = !!option.children?.length
  const isExpanded = expandedValues.has(option.value)
  const isSelected = selectedValue === option.value
  const label = getOptionLabel(option, language)

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-text-secondary hover:bg-state-base-hover',
          isSelected && 'text-text-accent',
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={() => onSelect(option.value)}
      >
        {hasChildren
          ? (
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand(option.value)
                }}
              >
                {isExpanded ? <RiArrowDownSLine className="h-4 w-4" /> : <RiArrowRightSLine className="h-4 w-4" />}
              </span>
            )
          : (
              <span className="inline-block h-4 w-4 shrink-0" />
            )}
        <span className="grow truncate system-sm-regular">{label}</span>
        {isSelected && <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />}
      </button>
      {hasChildren && isExpanded && option.children?.map(child => (
        <TreeNode
          key={child.value}
          expandedValues={expandedValues}
          language={language}
          level={level + 1}
          onSelect={onSelect}
          option={child}
          selectedValue={selectedValue}
          toggleExpand={toggleExpand}
        />
      ))}
    </div>
  )
}

const DynamicTreeSelectField: FC<Props> = ({
  disabled = false,
  isLoading = false,
  language,
  onChange,
  options,
  placeholder,
  value,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [expandedValues, setExpandedValues] = useState<Set<string>>(
    () => new Set(collectExpandableValues(options)),
  )

  const selectedNode = useMemo(
    () => findNodeByValue(options, value),
    [options, value],
  )
  const triggerText = selectedNode
    ? getOptionLabel(selectedNode, language)
    : (isLoading ? t('dynamicTreeSelect.loading', { ns: 'common' }) : placeholder)

  const toggleExpand = (optionValue: string) => {
    setExpandedValues((prev) => {
      const next = new Set(prev)
      if (next.has(optionValue))
        next.delete(optionValue)
      else
        next.add(optionValue)
      return next
    })
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-8 grow rounded-lg bg-components-input-bg-normal px-3 text-left system-sm-regular',
            'text-components-input-text-placeholder hover:bg-state-base-hover-alt',
            selectedNode && 'text-components-input-text-filled',
          )}
          disabled={disabled || isLoading}
        >
          <span className="line-clamp-1">{triggerText || t('dynamicTreeSelect.placeholder', { ns: 'common' })}</span>
          {isLoading && <RiLoader4Line className="float-right mt-0.5 h-3.5 w-3.5 animate-spin text-text-secondary" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-1"
        sideOffset={4}
      >
        {!options.length && (
          <div className="px-2 py-1.5 system-sm-regular text-text-tertiary">
            {t('dynamicTreeSelect.noData', { ns: 'common' })}
          </div>
        )}
        {options.map(option => (
          <TreeNode
            key={option.value}
            expandedValues={expandedValues}
            language={language}
            level={0}
            onSelect={handleSelect}
            option={option}
            selectedValue={value}
            toggleExpand={toggleExpand}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

export default DynamicTreeSelectField
