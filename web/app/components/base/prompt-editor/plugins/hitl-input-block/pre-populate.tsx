'use client'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Textarea from '../../../textarea'
import TagLabel from './tag-label'
import cn from '@/utils/classnames'
import { Variable02 } from '../../../icons/src/vender/solid/development'

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
  const { t } = useTranslation()

  const [onPlaceholderClicked, setOnPlaceholderClicked] = useState(false)
  const handlePlaceholderTypeClick = useCallback((isVar: boolean) => {
    setOnPlaceholderClicked(true)
    onIsVariableChange?.(isVar)
  }, [onIsVariableChange])

  const isShowPlaceholder = !onPlaceholderClicked && (isVariable ? (!valueSelector || valueSelector.length === 0) : !value)
  if (isShowPlaceholder)
    return <Placeholder onTypeClick={handlePlaceholderTypeClick} />

  const main = (() => {
    if (isVariable) {
      return (
        <VarReferencePicker
          nodeId={nodeId}
          value={valueSelector || []}
          onChange={onValueSelectorChange!}
          readonly={false}
          zIndex={1000}
        />
      )
    }
    return (
      <Textarea
        value={value || ''}
        onChange={e => onValueChange?.(e.target.value)}
      />
    )
  })()
  return (
    <div>
      {main}
      <div className={cn('inline-flex h-6 cursor-pointer items-center space-x-1 rounded-md pl-1.5 pr-2 text-text-tertiary hover:bg-components-button-ghost-bg-hover')} onClick={() => onIsVariableChange?.(!isVariable)}>
        <Variable02 className='size-3.5' />
        <div className='system-xs-medium'>{t(`${i18nPrefix}.useVarInstead`)}</div>
      </div>
    </div>
  )
}
export default React.memo(PrePopulate)
