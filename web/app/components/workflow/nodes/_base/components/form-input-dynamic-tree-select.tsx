'use client'

import type { FC } from 'react'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine, RiArrowRightSLine, RiCheckLine, RiLoader4Line } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  disabled?: boolean
  isLoading?: boolean
  language: string
  multiple?: boolean
  onChange: (value: string[]) => void
  options: FormOption[]
  placeholder?: string
  value?: string[]
}

const getOptionLabel = (option: FormOption, language: string) =>
  option.label?.[language] || option.label?.en_US || option.value

const findNodeByValue = (options: FormOption[], value: string): FormOption | undefined => {
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

const collectExpandableValues = (options: FormOption[]): string[] => {
  const values: string[] = []
  for (const option of options) {
    if (option.children?.length) {
      values.push(option.value)
      values.push(...collectExpandableValues(option.children))
    }
  }
  return values
}

const normalizeValues = (value?: string[]) => {
  if (!value?.length)
    return []
  return [...new Set(value.filter(item => typeof item === 'string' && item))]
}

type TreeNodeProps = {
  expandedValues: Set<string>
  language: string
  level: number
  onSelect: (value: string) => void
  option: FormOption
  selectedValues: Set<string>
  toggleExpand: (value: string) => void
}

const TreeNode: FC<TreeNodeProps> = ({
  expandedValues,
  language,
  level,
  onSelect,
  option,
  selectedValues,
  toggleExpand,
}) => {
  const hasChildren = !!option.children?.length
  const isExpanded = expandedValues.has(option.value)
  const isSelected = selectedValues.has(option.value)
  const label = getOptionLabel(option, language)

  return (
    <div>
      <div
        className={cn(
          'group flex w-full items-center gap-1 rounded-lg py-1.5 pr-2 hover:bg-state-base-hover',
          isSelected ? 'text-text-accent' : 'text-text-secondary',
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        {hasChildren
          ? (
              <button
                type="button"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                aria-expanded={isExpanded}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-secondary"
                onClick={() => toggleExpand(option.value)}
              >
                {isExpanded ? <RiArrowDownSLine className="h-4 w-4" /> : <RiArrowRightSLine className="h-4 w-4" />}
              </button>
            )
          : (
              <span aria-hidden className="inline-block h-4 w-4 shrink-0" />
            )}
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          className="flex min-w-0 grow items-center gap-2 text-left"
          onClick={() => onSelect(option.value)}
        >
          {option.icon && (
            <img src={option.icon} alt="" className="h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0 grow truncate system-sm-regular">{label}</span>
          {isSelected && <RiCheckLine aria-hidden className="h-4 w-4 shrink-0 text-text-accent" />}
        </button>
      </div>
      {hasChildren && isExpanded && option.children?.map(child => (
        <TreeNode
          key={child.value}
          expandedValues={expandedValues}
          language={language}
          level={level + 1}
          onSelect={onSelect}
          option={child}
          selectedValues={selectedValues}
          toggleExpand={toggleExpand}
        />
      ))}
    </div>
  )
}

const FormInputDynamicTreeSelect: FC<Props> = ({
  disabled = false,
  isLoading = false,
  language,
  multiple = false,
  onChange,
  options,
  placeholder,
  value,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [collapsedValues, setCollapsedValues] = useState<Set<string>>(() => new Set())
  const selectedValues = useMemo(() => normalizeValues(value), [value])
  const selectedValueSet = useMemo(() => new Set(selectedValues), [selectedValues])
  const expandedValues = useMemo(() => {
    const expandableValues = collectExpandableValues(options)
    return new Set(expandableValues.filter(value => !collapsedValues.has(value)))
  }, [collapsedValues, options])

  const fallbackPlaceholder = placeholder || t('placeholder.select', { ns: 'common' })

  const triggerLabel = useMemo(() => {
    if (isLoading)
      return t('dynamicSelect.loading', { ns: 'common' })

    if (!selectedValues.length)
      return fallbackPlaceholder

    const selectedNodes = selectedValues
      .map(v => findNodeByValue(options, v))
      .filter((node): node is FormOption => !!node)

    if (!selectedNodes.length)
      return fallbackPlaceholder

    if (selectedNodes.length <= 2)
      return selectedNodes.map(node => getOptionLabel(node, language)).join(', ')

    return t('dynamicSelect.selected', { count: selectedNodes.length, ns: 'common' })
  }, [fallbackPlaceholder, isLoading, language, options, selectedValues, t])

  const toggleExpand = (optionValue: string) => {
    setCollapsedValues((prev) => {
      const next = new Set(prev)
      if (next.has(optionValue))
        next.delete(optionValue)
      else
        next.add(optionValue)
      return next
    })
  }

  const handleSelect = (nextValue: string) => {
    if (multiple) {
      if (selectedValueSet.has(nextValue))
        onChange(selectedValues.filter(item => item !== nextValue))
      else
        onChange([...selectedValues, nextValue])
      return
    }

    onChange([nextValue])
    setIsOpen(false)
  }

  const hasSelection = selectedValues.length > 0

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        disabled={disabled || isLoading}
        render={(
          <button
            type="button"
            className={cn(
              'group/dynamic-tree relative flex h-8 w-full grow items-center rounded-lg border-0 bg-components-input-bg-normal pr-10 pl-3 text-left',
              'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:outline-hidden',
              'disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled disabled:hover:bg-components-input-bg-disabled',
              'system-sm-regular',
              hasSelection
                ? 'text-components-input-text-filled'
                : 'text-components-input-text-placeholder',
            )}
          >
            <span className="block min-w-0 grow truncate">
              {triggerLabel}
            </span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-2">
              {isLoading
                ? <RiLoader4Line aria-hidden className="h-3.5 w-3.5 animate-spin text-text-secondary" />
                : (
                    <ChevronDownIcon
                      aria-hidden
                      className="h-4 w-4 text-text-quaternary group-hover/dynamic-tree:text-text-secondary"
                    />
                  )}
            </span>
          </button>
        )}
      />
      <PopoverContent
        sideOffset={4}
        popupClassName="w-(--anchor-width) max-h-80 overflow-auto p-1"
      >
        {!options.length
          ? (
              <div className="px-2 py-1.5 system-sm-regular text-text-tertiary">
                {t('dynamicSelect.noData', { ns: 'common' })}
              </div>
            )
          : (
              <div role="listbox" aria-multiselectable={multiple ? true : undefined}>
                {options.map(option => (
                  <TreeNode
                    key={option.value}
                    expandedValues={expandedValues}
                    language={language}
                    level={0}
                    onSelect={handleSelect}
                    option={option}
                    selectedValues={selectedValueSet}
                    toggleExpand={toggleExpand}
                  />
                ))}
              </div>
            )}
      </PopoverContent>
    </Popover>
  )
}

export default FormInputDynamicTreeSelect
