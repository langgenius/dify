import type { FC } from 'react'
import type { ScheduleTriggerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import Input from '@/app/components/base/input'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import FrequencySelector from './components/frequency-selector'
import ModeToggle from './components/mode-toggle'
import MonthlyDaysSelector from './components/monthly-days-selector'
import NextExecutionTimes from './components/next-execution-times'
import OnMinuteSelector from './components/on-minute-selector'
import WeekdaySelector from './components/weekday-selector'
import useConfig from './use-config'

const i18nPrefix = 'nodes.triggerSchedule'

const Panel: FC<NodePanelProps<ScheduleTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    inputs,
    setInputs,
    handleModeChange,
    handleFrequencyChange,
    handleCronExpressionChange,
    handleWeekdaysChange,
    handleTimeChange,
    handleOnMinuteChange,
  } = useConfig(id, data)

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-3 pt-2">
        <Field
          title={t(`${i18nPrefix}.title`, { ns: 'workflow' })}
          operations={(
            <ModeToggle
              mode={inputs.mode}
              onChange={handleModeChange}
            />
          )}
        >
          <div className="space-y-3">

            {inputs.mode === 'visual' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-gray-500">
                      {t('nodes.triggerSchedule.frequencyLabel', { ns: 'workflow' })}
                    </label>
                    <FrequencySelector
                      frequency={inputs.frequency || 'daily'}
                      onChange={handleFrequencyChange}
                    />
                  </div>
                  <div className="col-span-2">
                    {inputs.frequency === 'hourly'
                      ? (
                          <OnMinuteSelector
                            value={inputs.visual_config?.on_minute}
                            onChange={handleOnMinuteChange}
                          />
                        )
                      : (
                          <>
                            <label className="mb-2 block text-xs font-medium text-gray-500">
                              {t('nodes.triggerSchedule.time', { ns: 'workflow' })}
                            </label>
                            <TimePicker
                              notClearable={true}
                              timezone={inputs.timezone}
                              value={inputs.visual_config?.time || '12:00 AM'}
                              triggerFullWidth={true}
                              onChange={(time) => {
                                if (time) {
                                  const timeString = time.format('h:mm A')
                                  handleTimeChange(timeString)
                                }
                              }}
                              onClear={() => {
                                handleTimeChange('12:00 AM')
                              }}
                              placeholder={t('nodes.triggerSchedule.selectTime', { ns: 'workflow' })}
                              showTimezone={true}
                            />
                          </>
                        )}
                  </div>
                </div>

                {inputs.frequency === 'weekly' && (
                  <WeekdaySelector
                    selectedDays={inputs.visual_config?.weekdays || []}
                    onChange={handleWeekdaysChange}
                  />
                )}

                {inputs.frequency === 'monthly' && (
                  <MonthlyDaysSelector
                    selectedDays={inputs.visual_config?.monthly_days || [1]}
                    onChange={(days) => {
                      const newInputs = {
                        ...inputs,
                        visual_config: {
                          ...inputs.visual_config,
                          monthly_days: days,
                        },
                      }
                      setInputs(newInputs)
                    }}
                  />
                )}
              </div>
            )}

            {inputs.mode === 'cron' && (
              <div className="space-y-2">
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-500">
                    {t('nodes.triggerSchedule.cronExpression', { ns: 'workflow' })}
                  </label>
                  <Input
                    value={inputs.cron_expression || ''}
                    onChange={e => handleCronExpressionChange(e.target.value)}
                    placeholder="0 0 * * *"
                    className="font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        </Field>

        <div className="border-t border-divider-subtle"></div>

        <NextExecutionTimes data={inputs} />

      </div>
    </div>
  )
}

export default React.memo(Panel)
