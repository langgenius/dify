'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'

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
        <Input
          type="number"
          value={timeout}
          onChange={e => onTimeoutChange(Number(e.target.value))}
          placeholder={t('mcp.modal.timeoutPlaceholder', { ns: 'tools' })}
        />
      </div>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <span className="system-sm-medium text-text-secondary">{t('mcp.modal.sseReadTimeout', { ns: 'tools' })}</span>
        </div>
        <Input
          type="number"
          value={sseReadTimeout}
          onChange={e => onSseReadTimeoutChange(Number(e.target.value))}
          placeholder={t('mcp.modal.timeoutPlaceholder', { ns: 'tools' })}
        />
      </div>
    </>
  )
}

export default ConfigurationsSection
