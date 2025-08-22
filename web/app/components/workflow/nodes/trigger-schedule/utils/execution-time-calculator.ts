import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'
import { formatDateInTimezone, getCurrentTimeInTimezone } from './timezone-utils'

const getCurrentTime = (timezone?: string): Date => {
  return timezone ? getCurrentTimeInTimezone(timezone) : new Date()
}

// Helper function to get default datetime for once/hourly modes - consistent with base DatePicker
export const getDefaultDateTime = (): Date => {
  const defaultDate = new Date()
  defaultDate.setHours(11, 30, 0, 0)
  defaultDate.setDate(defaultDate.getDate() + 1)
  return defaultDate
}

export const getNextExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): Date[] => {
  if (data.mode === 'cron') {
    if (!data.cron_expression || !isValidCronExpression(data.cron_expression))
      return []
    return parseCronExpression(data.cron_expression).slice(0, count)
  }

  const times: Date[] = []
  const defaultTime = data.visual_config?.time || '11:30 AM'

  if (data.frequency === 'hourly') {
    const onMinute = data.visual_config?.on_minute ?? 0
    const now = getCurrentTime(data.timezone)
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    let nextExecution: Date
    if (currentMinute <= onMinute)
      nextExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHour, onMinute, 0, 0)
     else
      nextExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHour + 1, onMinute, 0, 0)

    for (let i = 0; i < count; i++) {
      const execution = new Date(nextExecution)
      execution.setHours(nextExecution.getHours() + i)
      times.push(execution)
    }
  }
  else if (data.frequency === 'daily') {
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime(data.timezone)
    const baseExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate(), displayHour, Number.parseInt(minute), 0, 0)

    // Calculate initial offset: if time has passed today, start from tomorrow
    const initialOffset = baseExecution <= now ? 1 : 0

    for (let i = 0; i < count; i++) {
      const nextExecution = new Date(baseExecution)
      nextExecution.setDate(baseExecution.getDate() + initialOffset + i)
      times.push(nextExecution)
    }
  }
  else if (data.frequency === 'weekly') {
    const selectedDays = data.visual_config?.weekdays || ['sun']
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime(data.timezone)
    let weekOffset = 0

    const currentWeekExecutions: Date[] = []
    for (const selectedDay of selectedDays) {
      const targetDay = dayMap[selectedDay as keyof typeof dayMap]
      let daysUntilNext = (targetDay - now.getDay() + 7) % 7

      const nextExecutionBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), displayHour, Number.parseInt(minute), 0, 0)

      if (daysUntilNext === 0 && nextExecutionBase <= now)
        daysUntilNext = 7

      if (daysUntilNext < 7) {
        const execution = new Date(nextExecutionBase)
        execution.setDate(execution.getDate() + daysUntilNext)
        currentWeekExecutions.push(execution)
      }
    }

    if (currentWeekExecutions.length === 0)
      weekOffset = 1

    let weeksChecked = 0
    while (times.length < count && weeksChecked < 8) {
      for (const selectedDay of selectedDays) {
        if (times.length >= count) break

        const targetDay = dayMap[selectedDay as keyof typeof dayMap]
        const execution = new Date(now.getFullYear(), now.getMonth(), now.getDate(), displayHour, Number.parseInt(minute), 0, 0)
        execution.setDate(execution.getDate() + (targetDay - now.getDay() + 7) % 7 + (weekOffset + weeksChecked) * 7)

        if (execution > now)
          times.push(execution)
      }
      weeksChecked++
    }

    times.sort((a, b) => a.getTime() - b.getTime())
    times.splice(count)
  }
  else if (data.frequency === 'monthly') {
    const getSelectedDays = (): (number | 'last')[] => {
      if (data.visual_config?.monthly_days && data.visual_config.monthly_days.length > 0)
        return data.visual_config.monthly_days

      return [1]
    }

    const selectedDays = [...new Set(getSelectedDays())]
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime(data.timezone)
    let monthOffset = 0

    const hasValidCurrentMonthExecution = selectedDays.some((selectedDay) => {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()

      let targetDay: number
      if (selectedDay === 'last')
        targetDay = daysInMonth
       else
        targetDay = Math.min(selectedDay as number, daysInMonth)

      const execution = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), targetDay, displayHour, Number.parseInt(minute), 0, 0)
      return execution > now
    })

    if (!hasValidCurrentMonthExecution)
      monthOffset = 1

    let monthsChecked = 0

    while (times.length < count && monthsChecked < 24) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + monthsChecked, 1)
      const daysInMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()

      const monthlyExecutions: Date[] = []

      for (const selectedDay of selectedDays) {
        let targetDay: number

        if (selectedDay === 'last')
          targetDay = daysInMonth
         else
          targetDay = Math.min(selectedDay as number, daysInMonth)

        const nextExecution = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), targetDay, displayHour, Number.parseInt(minute), 0, 0)

        if (nextExecution > now)
          monthlyExecutions.push(nextExecution)
      }

      monthlyExecutions.sort((a, b) => a.getTime() - b.getTime())

      for (const execution of monthlyExecutions) {
        if (times.length >= count) break
        times.push(execution)
      }

      monthsChecked++
    }
  }
  else {
    // Fallback for unknown frequencies
    for (let i = 0; i < count; i++) {
      const now = getCurrentTime(data.timezone)
      const nextExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1)
      times.push(nextExecution)
    }
  }

  return times
}

export const formatExecutionTime = (date: Date, timezone: string, includeWeekday: boolean = true): string => {
  return formatDateInTimezone(date, timezone, includeWeekday)
}

export const getFormattedExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): string[] => {
  const times = getNextExecutionTimes(data, count)

  return times.map((date) => {
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(date, data.timezone, includeWeekday)
  })
}

export const getNextExecutionTime = (data: ScheduleTriggerNodeType): string => {
  const times = getFormattedExecutionTimes(data, 1)
  if (times.length === 0) {
    const now = getCurrentTime(data.timezone)
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(now, data.timezone, includeWeekday)
  }
  return times[0]
}
