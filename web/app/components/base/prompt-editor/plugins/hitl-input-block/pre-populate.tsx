'use client'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Textarea from '../../../textarea'
import TagLabel from './tag-label'
import TypeSwitch from './type-switch'
import cn from '@/utils/classnames'

type Props = {
  isVariable?: boolean
  onIsVariableChange?: (isVariable: boolean) => void
  nodeId: string
  valueSelector?: ValueSelector
  onValueSelectorChange?: (valueSelector: ValueSelector | string) => void
  value?: string
  onValueChange?: (value: string) => void
}

const i18nPrefix = 'workflow.nodes.humanInput.insertInputField'

type PlaceholderProps = {
  varPickerProps: any
  onTypeClick: (isVariable: boolean) => void
}
const Placeholder = ({
  varPickerProps,
  onTypeClick,
}: PlaceholderProps) => {
  const { t } = useTranslation()
  return (
    <div className='system-sm-regular mt-1 h-[80px] rounded-lg bg-components-input-bg-normal px-3 pt-2 text-text-tertiary'>
      <div className='flex flex-wrap items-center leading-5'>
        <Trans
          i18nKey={`${i18nPrefix}.prePopulateFieldPlaceholder`}
          components={{
            staticContent: <TagLabel type='edit' className='mx-1' onClick={() => onTypeClick(false)}>{t(`${i18nPrefix}.staticContent`)}</TagLabel>,
            variable: <VarReferencePicker
              {...varPickerProps}
              trigger={
                <TagLabel type='variable' className='mx-1'>{t(`${i18nPrefix}.variable`)}</TagLabel>
              }
            />,
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
    zIndex: 1000,
  }

  const isShowPlaceholder = !onPlaceholderClicked && (isVariable ? (!valueSelector || valueSelector.length === 0) : !value)
  if (isShowPlaceholder)
    return <Placeholder varPickerProps={varPickerProps} onTypeClick={handleTypeChange} />

  if (isVariable) {
    return (
      <div className='relative h-[80px] rounded-lg border border-transparent bg-components-input-bg-normal px-3 pt-2'>
        <VarReferencePicker
          {...varPickerProps}
          isJustShowValue
        />
        <TypeSwitch
          className='absolute bottom-1 left-1.5'
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
        className='h-[43px] min-h-[43px] rounded-none border-none bg-transparent px-3 hover:bg-transparent focus:bg-transparent focus:shadow-none'
        onChange={e => onValueChange?.(e.target.value)}
        onFocus={() => {
          setOnPlaceholderClicked(true)
          setIsFocus(true)
        }}
        onBlur={() => setIsFocus(false)}
      />
      <TypeSwitch
        className='absolute bottom-1 left-1.5'
        isVariable={isVariable}
        onIsVariableChange={handleTypeChange}
      />
    </div>
  )
}
export default React.memo(PrePopulate)
