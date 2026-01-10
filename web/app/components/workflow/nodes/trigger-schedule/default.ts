import type { NodeDefault } from '../../types'
import type { ScheduleTriggerNodeType } from './types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'
import { getDefaultScheduleConfig } from './constants'
import { isValidCronExpression } from './utils/cron-parser'
import { getNextExecutionTimes } from './utils/execution-time-calculator'

const isValidTimeFormat = (time: string): boolean => {
  const timeRegex = /^(0?\d|1[0-2]):[0-5]\d (AM|PM)$/
  if (!timeRegex.test(time))
    return false

  const [timePart, period] = time.split(' ')
  const [hour, minute] = timePart.split(':')
  const hourNum = Number.parseInt(hour, 10)
  const minuteNum = Number.parseInt(minute, 10)

  return hourNum >= 1 && hourNum <= 12
    && minuteNum >= 0 && minuteNum <= 59
    && ['AM', 'PM'].includes(period)
}

const validateHourlyConfig = (config: any, t: any): string => {
  if (config.on_minute === undefined || config.on_minute < 0 || config.on_minute > 59)
    return t('nodes.triggerSchedule.invalidOnMinute', { ns: 'workflow' })

  return ''
}

const validateDailyConfig = (config: any, t: any): string => {
  const i18nPrefix = 'workflow.errorMsg'

  if (!config.time)
    return t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.time', { ns: 'workflow' }) })

  if (!isValidTimeFormat(config.time))
    return t('nodes.triggerSchedule.invalidTimeFormat', { ns: 'workflow' })

  return ''
}

const validateWeeklyConfig = (config: any, t: any): string => {
  const dailyError = validateDailyConfig(config, t)
  if (dailyError)
    return dailyError

  const i18nPrefix = 'workflow.errorMsg'

  if (!config.weekdays || config.weekdays.length === 0)
    return t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.weekdays', { ns: 'workflow' }) })

  const validWeekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  for (const day of config.weekdays) {
    if (!validWeekdays.includes(day))
      return t('nodes.triggerSchedule.invalidWeekday', { ns: 'workflow', weekday: day })
  }

  return ''
}

const validateMonthlyConfig = (config: any, t: any): string => {
  const dailyError = validateDailyConfig(config, t)
  if (dailyError)
    return dailyError

  const i18nPrefix = 'workflow.errorMsg'

  const getMonthlyDays = (): (number | 'last')[] => {
    if (Array.isArray(config.monthly_days) && config.monthly_days.length > 0)
      return config.monthly_days

    return []
  }

  const monthlyDays = getMonthlyDays()

  if (monthlyDays.length === 0)
    return t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.monthlyDay', { ns: 'workflow' }) })

  for (const day of monthlyDays) {
    if (day !== 'last' && (typeof day !== 'number' || day < 1 || day > 31))
      return t('nodes.triggerSchedule.invalidMonthlyDay', { ns: 'workflow' })
  }

  return ''
}

const validateVisualConfig = (payload: ScheduleTriggerNodeType, t: any): string => {
  const i18nPrefix = 'workflow.errorMsg'
  const { visual_config } = payload

  if (!visual_config)
    return t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.visualConfig', { ns: 'workflow' }) })

  switch (payload.frequency) {
    case 'hourly':
      return validateHourlyConfig(visual_config, t)
    case 'daily':
      return validateDailyConfig(visual_config, t)
    case 'weekly':
      return validateWeeklyConfig(visual_config, t)
    case 'monthly':
      return validateMonthlyConfig(visual_config, t)
    default:
      return t('nodes.triggerSchedule.invalidFrequency', { ns: 'workflow' })
  }
}

const metaData = genNodeMetaData({
  sort: 2,
  type: BlockEnum.TriggerSchedule,
  helpLinkUri: 'schedule-trigger',
  isStart: true,
})

const nodeDefault: NodeDefault<ScheduleTriggerNodeType> = {
  metaData,
  defaultValue: {
    ...getDefaultScheduleConfig(),
    cron_expression: '',
  } as ScheduleTriggerNodeType,
  checkValid(payload: ScheduleTriggerNodeType, t: any) {
    const i18nPrefix = 'errorMsg'
    let errorMessages = ''
    if (!errorMessages && !payload.mode)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.mode', { ns: 'workflow' }) })

    // Validate timezone format if provided (timezone will be auto-filled by use-config.ts if undefined)
    if (!errorMessages && payload.timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: payload.timezone })
      }
      catch {
        errorMessages = t('nodes.triggerSchedule.invalidTimezone', { ns: 'workflow' })
      }
    }
    if (!errorMessages) {
      if (payload.mode === 'cron') {
        if (!payload.cron_expression || payload.cron_expression.trim() === '')
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.cronExpression', { ns: 'workflow' }) })
        else if (!isValidCronExpression(payload.cron_expression))
          errorMessages = t('nodes.triggerSchedule.invalidCronExpression', { ns: 'workflow' })
      }
      else if (payload.mode === 'visual') {
        if (!payload.frequency)
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.triggerSchedule.frequency', { ns: 'workflow' }) })
        else
          errorMessages = validateVisualConfig(payload, t)
      }
    }
    if (!errorMessages) {
      try {
        const nextTimes = getNextExecutionTimes(payload, 1)
        if (nextTimes.length === 0)
          errorMessages = t('nodes.triggerSchedule.noValidExecutionTime', { ns: 'workflow' })
      }
      catch {
        errorMessages = t('nodes.triggerSchedule.executionTimeCalculationError', { ns: 'workflow' })
      }
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
