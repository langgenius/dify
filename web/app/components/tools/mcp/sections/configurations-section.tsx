'use client'
import type { FC } from 'react'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
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

  return (
    <>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.timeout', { ns: 'tools' })}</span>
        </div>
        <NumberField
          value={timeout}
          min={0}
          onValueChange={value => onTimeoutChange(value ?? 0)}
        >
          <NumberFieldGroup>
            <NumberFieldInput placeholder={t('mcp.modal.timeoutPlaceholder', { ns: 'tools' })} />
          </NumberFieldGroup>
        </NumberField>
      </div>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.sseReadTimeout', { ns: 'tools' })}</span>
        </div>
        <NumberField
          value={sseReadTimeout}
          min={0}
          onValueChange={value => onSseReadTimeoutChange(value ?? 0)}
        >
          <NumberFieldGroup>
            <NumberFieldInput placeholder={t('mcp.modal.timeoutPlaceholder', { ns: 'tools' })} />
          </NumberFieldGroup>
        </NumberField>
      </div>
    </>
  )
}

export default ConfigurationsSection
