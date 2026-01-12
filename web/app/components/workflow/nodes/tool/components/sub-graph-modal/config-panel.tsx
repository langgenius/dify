'use client'
import type { FC } from 'react'
import type { ConfigPanelProps, WhenOutputNoneOption } from './types'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { cn } from '@/utils/classnames'

const outputVariables = [
  { name: 'text', type: 'string' },
  { name: 'structured_output', type: 'object' },
]

const ConfigPanel: FC<ConfigPanelProps> = ({
  toolNodeId: _toolNodeId,
  paramKey: _paramKey,
  activeTab,
}) => {
  const { t } = useTranslation()
  const [whenOutputNone, setWhenOutputNone] = useState<WhenOutputNoneOption>('skip')

  const handleWhenOutputNoneChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setWhenOutputNone(e.target.value as WhenOutputNoneOption)
  }, [])

  if (activeTab === 'lastRun') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <p className="system-sm-regular text-text-tertiary">
            {t('subGraphModal.noRunHistory', { ns: 'workflow' })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <Field
        title={t('subGraphModal.outputVariables', { ns: 'workflow' })}
      >
        <div className="space-y-2">
          {outputVariables.map(variable => (
            <div
              key={variable.name}
              className="flex items-center justify-between rounded-lg bg-components-input-bg-normal px-3 py-2"
            >
              <span className="system-sm-medium text-text-secondary">{variable.name}</span>
              <span className="system-xs-regular text-text-tertiary">{variable.type}</span>
            </div>
          ))}
        </div>
      </Field>

      <Field
        title={t('subGraphModal.whenOutputIsNone', { ns: 'workflow' })}
      >
        <select
          className={cn(
            'w-full rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2',
            'system-sm-regular text-text-secondary',
            'focus:border-primary-600 focus:outline-none',
          )}
          value={whenOutputNone}
          onChange={handleWhenOutputNoneChange}
        >
          <option value="skip">
            {t('subGraphModal.whenOutputNone.skip', { ns: 'workflow' })}
          </option>
          <option value="error">
            {t('subGraphModal.whenOutputNone.error', { ns: 'workflow' })}
          </option>
          <option value="default">
            {t('subGraphModal.whenOutputNone.default', { ns: 'workflow' })}
          </option>
        </select>
      </Field>
    </div>
  )
}

export default memo(ConfigPanel)
