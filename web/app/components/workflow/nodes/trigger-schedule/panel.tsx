import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import ModeToggle from './components/mode-toggle'
import FrequencySelector from './components/frequency-selector'
import WeekdaySelector from './components/weekday-selector'
import Input from '@/app/components/base/input'
import useConfig from './use-config'

const i18nPrefix = 'workflow.nodes.triggerSchedule'

const Panel: FC<NodePanelProps<ScheduleTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    inputs,
    handleModeChange,
    handleFrequencyChange,
    handleCronExpressionChange,
    handleWeekdaysChange,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-3 pt-2'>
        <Field
          title={t(`${i18nPrefix}.title`)}
          operations={
            <ModeToggle
              mode={inputs.mode}
              onChange={handleModeChange}
            />
          }
        >
          <div className="space-y-3">

            {inputs.mode === 'visual' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-500">
                      {t('workflow.nodes.triggerSchedule.frequencyLabel')}
                    </label>
                    <FrequencySelector
                      frequency={inputs.frequency}
                      onChange={handleFrequencyChange}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-xs font-medium text-gray-500">
                      {t('workflow.nodes.triggerSchedule.time')}
                    </label>
                    <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="text-sm text-gray-600">11:30 AM</span>
                      <div className="ml-auto">
                        <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                {inputs.frequency === 'weekly' && (
                  <WeekdaySelector
                    selectedDays={inputs.visual_config?.weekdays || []}
                    onChange={handleWeekdaysChange}
                  />
                )}
              </div>
            )}

            {inputs.mode === 'cron' && (
              <div className="space-y-2">
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-500">
                    {t('workflow.nodes.triggerSchedule.cronExpression')}
                  </label>
                  <Input
                    value={inputs.cron_expression || ''}
                    onChange={e => handleCronExpressionChange(e.target.value)}
                    placeholder="0 0 * * *"
                    className="font-mono"
                  />
                </div>
                <div className="text-xs text-gray-500">
                  Enter cron expression (minute hour day month weekday)
                </div>
              </div>
            )}
          </div>
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
