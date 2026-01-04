import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'

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
      title={t('nodes.llm.reasoningFormat.title', { ns: 'workflow' })}
      tooltip={t('nodes.llm.reasoningFormat.tooltip', { ns: 'workflow' })}
      operations={(
        // ON = separated, OFF = tagged
        <Switch
          defaultValue={value === 'separated'}
          onChange={enabled => onChange(enabled ? 'separated' : 'tagged')}
          size="md"
          disabled={readonly}
          key={value}
        />
      )}
    >
      <div />
    </Field>
  )
}

export default ReasoningFormatConfig
