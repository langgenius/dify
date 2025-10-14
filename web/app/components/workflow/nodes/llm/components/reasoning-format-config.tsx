import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'

type ReasoningFormatConfigProps = {
  value?: 'tagged' | 'separated'
  onChange: (value: 'tagged' | 'separated') => void
  readonly?: boolean
}

const ReasoningFormatConfig: FC<ReasoningFormatConfigProps> = ({
  value = 'tagged',
  onChange,
  readonly = false,
}) => {
  const { t } = useTranslation()

  return (
    <Field
      title={t('workflow.nodes.llm.reasoningFormat.title')}
      tooltip={t('workflow.nodes.llm.reasoningFormat.tooltip')}
      operations={
        // ON = separated, OFF = tagged
        <Switch
          defaultValue={value === 'separated'}
          onChange={enabled => onChange(enabled ? 'separated' : 'tagged')}
          size='md'
          disabled={readonly}
          key={value}
        />
      }
    >
      <div />
    </Field>
  )
}

export default ReasoningFormatConfig
