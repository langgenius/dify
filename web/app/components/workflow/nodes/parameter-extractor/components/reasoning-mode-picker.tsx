'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ReasoningModeType } from '../types'
import Field from '../../_base/components/field'
import OptionCard from '../../_base/components/option-card'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

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
      <div className='grid grid-cols-2 gap-x-1'>
        <OptionCard
          title='Function/Tool Calling'
          onSelect={handleChange(ReasoningModeType.functionCall)}
          selected={type === ReasoningModeType.functionCall}
        />
        <OptionCard
          title='Prompt'
          selected={type === ReasoningModeType.prompt}
          onSelect={handleChange(ReasoningModeType.prompt)}
        />
      </div>
    </Field>

  )
}
export default React.memo(ReasoningModePicker)
