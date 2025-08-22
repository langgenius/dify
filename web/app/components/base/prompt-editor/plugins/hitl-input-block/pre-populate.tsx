'use client'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
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

const Placeholder = () => {
  const { t } = useTranslation()
  return (
    <div className='system-sm-regular mt-1 px-3 text-text-tertiary'>
      <div className="flex h-5 items-center space-x-1">
        <span>{t(`${i18nPrefix}.add`)}</span>
        <TagLabel type='edit' text={t(`${i18nPrefix}.staticContent`)} />
        <span>{t(`${i18nPrefix}.or`)}</span>
        <TagLabel type='variable' text={t(`${i18nPrefix}.variable`)} />
        <span>{t(`${i18nPrefix}.users`)}</span>
      </div>
      <div className="flex h-5 items-center">{t(`${i18nPrefix}.prePopulateFieldPlaceholderEnd`)}</div>
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

  const main = (() => {
    const isShowPlaceholder = isVariable ? (!valueSelector || valueSelector.length === 0) : !value
    if (isShowPlaceholder)
      return <Placeholder />
    if (isVariable) {
      return (
        <VarReferencePicker
          nodeId={nodeId}
          value={valueSelector || []}
          onChange={onValueSelectorChange!}
          readonly={false}
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
      <div className={cn('flex  space-x-1 text-text-tertiary')}>
        <Variable02 className='size-3.5' />
        <div>{t(`${i18nPrefix}.useVarInstead`)}</div>
      </div>
    </div>
  )
}
export default React.memo(PrePopulate)
