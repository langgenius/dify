import type { FC } from 'react'
import type { ScheduleTriggerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  TimePicker,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
} from '@/app/components/base/date-time-picker/time-picker'
import WorkflowField from '@/app/components/workflow/nodes/_base/components/field'
import FrequencySelector from './components/frequency-selector'
import ModeToggle from './components/mode-toggle'
import MonthlyDaysSelector from './components/monthly-days-selector'
import NextExecutionTimes from './components/next-execution-times'
import OnMinuteSelector from './components/on-minute-selector'
import WeekdaySelector from './components/weekday-selector'
import useConfig from './use-config'
import { formatClockTime, parseClockTime } from './utils/clock-time'

const i18nPrefix = 'nodes.triggerSchedule'

const Panel: FC<NodePanelProps<ScheduleTriggerNodeType>> = ({ id, data }) => {
  const { t } = useTranslation(['workflow', 'workflowIntegrations'])
  const {
    readOnly,
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
      <div className="space-y-4 px-4 pt-2 pb-3">
        <WorkflowField
          title={t(($) => $[`${i18nPrefix}.title`], { ns: 'workflowIntegrations' })}
          operations={<ModeToggle mode={inputs.mode} onChange={handleModeChange} />}
        >
          <div className="space-y-3">
            {inputs.mode === 'visual' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <FrequencySelector
                    frequency={inputs.frequency || 'daily'}
                    onChange={handleFrequencyChange}
                  />
                  <div className="col-span-2">
                    {inputs.frequency === 'hourly' ? (
                      <OnMinuteSelector
                        value={inputs.visual_config?.on_minute}
                        onChange={handleOnMinuteChange}
                      />
                    ) : (
                      <div className="flex flex-col">
                        <TimePicker
                          readOnly={readOnly}
                          timeZone={inputs.timezone}
                          value={parseClockTime(inputs.visual_config?.time || '12:00 AM')}
                          onValueChange={(time) => {
                            if (time) handleTimeChange(formatClockTime(time))
                          }}
                        >
                          <TimePickerLabel className="text-xs">
                            {t(($) => $['nodes.triggerSchedule.time'], { ns: 'workflow' })}
                          </TimePickerLabel>
                          <TimePickerTrigger className="w-full">
                            <TimePickerValue className="flex flex-1 items-center justify-between">
                              {(value) => (
                                <>
                                  {value}
                                  <span className="text-text-tertiary">{inputs.timezone}</span>
                                </>
                              )}
                            </TimePickerValue>
                          </TimePickerTrigger>
                          <TimePickerContent />
                        </TimePicker>
                      </div>
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
              <Field className="gap-0">
                <FieldLabel className="text-xs">
                  {t(($) => $['nodes.triggerSchedule.cronExpression'], { ns: 'workflow' })}
                </FieldLabel>
                <Input
                  value={inputs.cron_expression || ''}
                  onValueChange={(value) => handleCronExpressionChange(value)}
                  placeholder="0 0 * * *"
                  className="font-mono"
                />
              </Field>
            )}
          </div>
        </WorkflowField>

        <div className="border-t border-divider-subtle"></div>

        <NextExecutionTimes data={inputs} />
      </div>
    </div>
  )
}

export default React.memo(Panel)
