'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { ReasoningModeType } from '../types'
import Field from '../../_base/components/field'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

type ItemProps = {
  isChosen: boolean
  text: string
  onClick: () => void
}

const Item: FC<ItemProps> = ({
  isChosen,
  text,
  onClick,
}) => {
  return (
    <div
      className={cn(isChosen ? 'border-[1.5px] border-primary-400 bg-white' : 'border border-gray-100 bg-gray-25', 'grow w-0 shrink-0 flex items-center h-8 justify-center rounded-lg cursor-pointer text-[13px] font-normal text-gray-900')}
      onClick={() => !isChosen ? onClick() : () => { }}
    >
      {text}
    </div>
  )
}

type Props = {
  type: ReasoningModeType
  onChange: (type: ReasoningModeType) => void
}

const ReasoningModePicker: FC<Props> = ({
  type,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleChange = useCallback((type: ReasoningModeType) => {
    return () => {
      onChange(type)
    }
  }, [onChange])

  return (
    <Field
      title={t(`${i18nPrefix}.reasoningMode`)}
      tooltip={t(`${i18nPrefix}.reasoningModeTip`)!}
    >
      <div className='flex space-x-1'>
        <Item
          isChosen={type === ReasoningModeType.functionCall}
          text='Function/Tool Calling'
          onClick={handleChange(ReasoningModeType.functionCall)}
        />
        <Item
          isChosen={type === ReasoningModeType.prompt}
          text='Prompt'
          onClick={handleChange(ReasoningModeType.prompt)}
        />
      </div>
    </Field>

  )
}
export default React.memo(ReasoningModePicker)
