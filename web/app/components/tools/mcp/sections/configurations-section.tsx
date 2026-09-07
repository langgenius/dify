'use client'
import type { FC } from 'react'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type ConfigurationsSectionProps = {
  timeout: number
  onTimeoutChange: (timeout: number) => void
  sseReadTimeout: number
  onSseReadTimeoutChange: (timeout: number) => void
}

const ConfigurationsSection: FC<ConfigurationsSectionProps> = ({
  timeout,
  onTimeoutChange,
  sseReadTimeout,
  onSseReadTimeoutChange,
}) => {
  const { t } = useTranslation()
  const timeoutInputId = useId()
  const sseReadTimeoutInputId = useId()

  return (
    <>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <label htmlFor={timeoutInputId} className="system-sm-medium text-text-secondary">
            {t(($) => $['mcp.modal.timeout'], { ns: 'tools' })}
          </label>
        </div>
        <NumberField value={timeout} min={0} onValueChange={(value) => onTimeoutChange(value ?? 0)}>
          <NumberFieldGroup>
            <NumberFieldInput
              id={timeoutInputId}
              placeholder={t(($) => $['mcp.modal.timeoutPlaceholder'], { ns: 'tools' })}
            />
          </NumberFieldGroup>
        </NumberField>
      </div>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <label htmlFor={sseReadTimeoutInputId} className="system-sm-medium text-text-secondary">
            {t(($) => $['mcp.modal.sseReadTimeout'], { ns: 'tools' })}
          </label>
        </div>
        <NumberField
          value={sseReadTimeout}
          min={0}
          onValueChange={(value) => onSseReadTimeoutChange(value ?? 0)}
        >
          <NumberFieldGroup>
            <NumberFieldInput
              id={sseReadTimeoutInputId}
              placeholder={t(($) => $['mcp.modal.timeoutPlaceholder'], { ns: 'tools' })}
            />
          </NumberFieldGroup>
        </NumberField>
      </div>
    </>
  )
}

export default ConfigurationsSection
