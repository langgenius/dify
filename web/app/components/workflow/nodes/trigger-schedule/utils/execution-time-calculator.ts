import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'
import { formatDateInTimezone } from './timezone-utils'

// Helper function to get default datetime - consistent with base DatePicker
export const getDefaultDateTime = (): Date => {
  const defaultDate = new Date(2024, 0, 2, 11, 30, 0, 0)
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

  // Get "today" in user's timezone for display purposes
  const now = new Date()
  const userTodayStr = now.toLocaleDateString('en-CA', { timeZone: data.timezone })
  const [year, month, day] = userTodayStr.split('-').map(Number)
  const userToday = new Date(year, month - 1, day, 0, 0, 0, 0)

  if (data.frequency === 'hourly') {
    const onMinute = data.visual_config?.on_minute ?? 0

    for (let i = 0; i < count; i++) {
      const execution = new Date(userToday)
      execution.setHours(i, onMinute, 0, 0)
      times.push(execution)
    }
  }
  else if (data.frequency === 'daily') {
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    for (let i = 0; i < count; i++) {
      const execution = new Date(userToday)
      execution.setDate(userToday.getDate() + i)
      execution.setHours(displayHour, Number.parseInt(minute), 0, 0)
      times.push(execution)
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

    let executionCount = 0
    let weekOffset = 0

    while (executionCount < count) {
      for (const selectedDay of selectedDays) {
        if (executionCount >= count) break

        const targetDay = dayMap[selectedDay as keyof typeof dayMap]
        const execution = new Date(userToday)
        execution.setDate(userToday.getDate() + targetDay + (weekOffset * 7))
        execution.setHours(displayHour, Number.parseInt(minute), 0, 0)

        times.push(execution)
        executionCount++
      }
      weekOffset++
    }

    times.sort((a, b) => a.getTime() - b.getTime())
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

    let executionCount = 0
    let monthOffset = 0

    while (executionCount < count) {
      const targetMonth = new Date(userToday.getFullYear(), userToday.getMonth() + monthOffset, 1)
      const daysInMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()

      const monthlyExecutions: Date[] = []
      const processedDays = new Set<number>()

      for (const selectedDay of selectedDays) {
        let targetDay: number

        if (selectedDay === 'last') {
          targetDay = daysInMonth
        }
        else {
          const dayNumber = selectedDay as number
          if (dayNumber > daysInMonth)
            continue

          targetDay = dayNumber
        }

        if (processedDays.has(targetDay))
          continue

        processedDays.add(targetDay)

        const execution = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), targetDay, displayHour, Number.parseInt(minute), 0, 0)
        monthlyExecutions.push(execution)
      }

      monthlyExecutions.sort((a, b) => a.getTime() - b.getTime())

      for (const execution of monthlyExecutions) {
        if (executionCount >= count) break
        times.push(execution)
        executionCount++
      }

      monthOffset++
    }
  }
  else {
    for (let i = 0; i < count; i++) {
      const execution = new Date(userToday)
      execution.setDate(userToday.getDate() + i)
      times.push(execution)
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
    const now = new Date()
    const userTodayStr = now.toLocaleDateString('en-CA', { timeZone: data.timezone })
    const [year, month, day] = userTodayStr.split('-').map(Number)
    const fallbackDate = new Date(year, month - 1, day, 12, 0, 0, 0)
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(fallbackDate, data.timezone, includeWeekday)
  }
  return times[0]
}
