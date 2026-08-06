import { useTranslation } from 'react-i18next'
import Field from '../../_base/components/field'
import InputNumberWithSlider from '../../_base/components/input-number-with-slider'
import {
  AGENT_V2_DEFAULT_REQUEST_LIMIT,
  AGENT_V2_MAX_REQUEST_LIMIT,
  AGENT_V2_MIN_REQUEST_LIMIT,
} from '../types'

const i18nPrefix = 'nodes.agent.requestLimit'

export function AgentRequestLimitField({
  value,
  onChange,
}: {
  value?: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const label = t(($) => $[`${i18nPrefix}.label`], { ns: 'workflow' })

  return (
    <Field
      title={<div className="pl-3">{label}</div>}
      tooltip={t(($) => $[`${i18nPrefix}.tooltip`], { ns: 'workflow' })}
    >
      <div className="px-3 py-2">
        <InputNumberWithSlider
          label={label}
          min={AGENT_V2_MIN_REQUEST_LIMIT}
          max={AGENT_V2_MAX_REQUEST_LIMIT}
          defaultValue={AGENT_V2_DEFAULT_REQUEST_LIMIT}
          value={value ?? AGENT_V2_DEFAULT_REQUEST_LIMIT}
          onChange={(nextValue) => {
            const normalizedValue = Number.isNaN(nextValue)
              ? AGENT_V2_DEFAULT_REQUEST_LIMIT
              : Math.round(nextValue)
            onChange(
              Math.min(
                AGENT_V2_MAX_REQUEST_LIMIT,
                Math.max(AGENT_V2_MIN_REQUEST_LIMIT, normalizedValue),
              ),
            )
          }}
        />
      </div>
    </Field>
  )
}
