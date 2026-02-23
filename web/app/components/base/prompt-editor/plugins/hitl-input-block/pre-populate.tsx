'use client'
import type { FC } from 'react'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import Textarea from '../../../textarea'
import TagLabel from './tag-label'
import TypeSwitch from './type-switch'

type Props = {
  isVariable?: boolean
  onIsVariableChange?: (isVariable: boolean) => void
  nodeId: string
  valueSelector?: ValueSelector
  onValueSelectorChange?: (valueSelector: ValueSelector | string) => void
  value?: string
  onValueChange?: (value: string) => void
}

const i18nPrefix = 'nodes.humanInput.insertInputField'

type PlaceholderProps = {
  varPickerProps: {
    nodeId: string
    value: ValueSelector
    onChange: (valueSelector: ValueSelector | string) => void
    readonly: boolean
    zIndex: number
    filterVar: (varPayload: Var) => boolean
    isJustShowValue?: boolean
  }
  onTypeClick: (isVariable: boolean) => void
}
const Placeholder = ({
  varPickerProps,
  onTypeClick,
}: PlaceholderProps) => {
  const { t } = useTranslation()
  return (
    <div className="system-sm-regular mt-1 h-[80px] rounded-lg bg-components-input-bg-normal px-3 pt-2 text-text-tertiary">
      <div className="flex flex-wrap items-center leading-5">
        <Trans
          i18nKey={`${i18nPrefix}.prePopulateFieldPlaceholder`}
          ns="workflow"
          components={{
            staticContent: <TagLabel type="edit" className="mx-1" onClick={() => onTypeClick(false)}>{t(`${i18nPrefix}.staticContent`, { ns: 'workflow' })}</TagLabel>,
            variable: (
              <VarReferencePicker
                {...varPickerProps}
                trigger={
                  <TagLabel type="variable" className="mx-1">{t(`${i18nPrefix}.variable`, { ns: 'workflow' })}</TagLabel>
                }
              />
            ),
          }}
        />
      </div>
    </div>
  )
}

const PrePopulate: FC<Props> = ({
  isVariable = false,
  onIsVariableChange,
  nodeId,
  valueSelector,
  onValueSelectorChange,
  value,
  onValueChange,
}) => {
  const [onPlaceholderClicked, setOnPlaceholderClicked] = useState(false)
  const handleTypeChange = useCallback((isVar: boolean) => {
    setOnPlaceholderClicked(true)
    onIsVariableChange?.(isVar)
  }, [onIsVariableChange])

  const [isFocus, setIsFocus] = useState(false)

  const varPickerProps = {
    nodeId,
    value: valueSelector || [],
    onChange: onValueSelectorChange!,
    readonly: false,
    zIndex: 1000000, // bigger than shortcut plugin popup
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  }

  const isShowPlaceholder = !onPlaceholderClicked && (isVariable ? (!valueSelector || valueSelector.length === 0) : !value)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !onPlaceholderClicked) {
        e.preventDefault()
        setOnPlaceholderClicked(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onPlaceholderClicked, setOnPlaceholderClicked])

  if (isShowPlaceholder)
    return <Placeholder varPickerProps={varPickerProps} onTypeClick={handleTypeChange} />

  if (isVariable) {
    return (
      <div className="relative h-[80px] rounded-lg border border-transparent bg-components-input-bg-normal px-3 pt-2">
        <VarReferencePicker
          {...varPickerProps}
          isJustShowValue
        />
        <TypeSwitch
          className="absolute bottom-1 left-1.5"
          isVariable={isVariable}
          onIsVariableChange={handleTypeChange}
        />
      </div>
    )
  }
  return (
    <div className={cn('relative min-h-[80px] rounded-lg border border-transparent bg-components-input-bg-normal pb-1', isFocus && 'border-components-input-border-active bg-components-input-bg-active shadow-xs')}>
      <Textarea
        value={value || ''}
        className="h-[43px] min-h-[43px] rounded-none border-none bg-transparent px-3 hover:bg-transparent focus:bg-transparent focus:shadow-none"
        onChange={e => onValueChange?.(e.target.value)}
        onFocus={() => {
          setOnPlaceholderClicked(true)
          setIsFocus(true)
        }}
        onBlur={() => setIsFocus(false)}
        autoFocus
      />
      <TypeSwitch
        className="absolute bottom-1 left-1.5"
        isVariable={isVariable}
        onIsVariableChange={handleTypeChange}
      />
    </div>
  )
}
export default React.memo(PrePopulate)
