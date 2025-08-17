import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import ModeToggle from './components/mode-toggle'
import FrequencySelector from './components/frequency-selector'
import WeekdaySelector from './components/weekday-selector'
import TimePicker from './components/time-picker'
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
    handleTimeChange,
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
                    <TimePicker
                      value={inputs.visual_config?.time || '11:30 AM'}
                      onChange={handleTimeChange}
                    />
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
