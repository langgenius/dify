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
  onTypeClick: (isVariable: boolean) => void
}
const Placeholder = ({
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
            variable: <TagLabel type='variable' className='mx-1' onClick={() => onTypeClick(true)}>{t(`${i18nPrefix}.variable`)}</TagLabel>,
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
  const handlePlaceholderTypeClick = useCallback((isVar: boolean) => {
    setOnPlaceholderClicked(true)
    onIsVariableChange?.(isVar)
  }, [onIsVariableChange])

  const [isFocus, setIsFocus] = useState(false)

  const isShowPlaceholder = !onPlaceholderClicked && (isVariable ? (!valueSelector || valueSelector.length === 0) : !value)
  if (isShowPlaceholder)
    return <Placeholder onTypeClick={handlePlaceholderTypeClick} />

  if (isVariable) {
    return (
      <div>
        <VarReferencePicker
          nodeId={nodeId}
          value={valueSelector || []}
          onChange={onValueSelectorChange!}
          readonly={false}
          zIndex={1000}
        />
        <TypeSwitch isVariable={isVariable} onIsVariableChange={onIsVariableChange} />
      </div>
    )
  }
  return (
    <div className={cn('relative rounded-md border border-transparent bg-components-input-bg-normal pb-1', isFocus && 'border-components-input-border-active bg-components-input-bg-active shadow-xs')}>
      <Textarea
        value={value || ''}
        className='rounded-b-none border-none bg-transparent px-3 pb-8 hover:bg-transparent focus:bg-transparent focus:shadow-none'
        onChange={e => onValueChange?.(e.target.value)}
        onFocus={() => setIsFocus(true)}
        onBlur={() => setIsFocus(false)}
      />
      <TypeSwitch
        className='ml-1.5'
        isVariable={isVariable}
        onIsVariableChange={onIsVariableChange}
      />
    </div>
  )
}
export default React.memo(PrePopulate)
