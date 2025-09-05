import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'

// Get current time completely in user timezone, no browser timezone involved
const getUserTimezoneCurrentTime = (timezone: string): Date => {
  const now = new Date()
  const userTimeStr = now.toLocaleString('en-CA', {
    timeZone: timezone,
    hour12: false,
  })
  const [dateStr, timeStr] = userTimeStr.split(', ')
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute, second] = timeStr.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, second)
}

// Format date that is already in user timezone, no timezone conversion
const formatUserTimezoneDate = (date: Date, includeWeekday: boolean = true): string => {
  const dateOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }

  if (includeWeekday)
    dateOptions.weekday = 'short'

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }

  return `${date.toLocaleDateString('en-US', dateOptions)} ${date.toLocaleTimeString('en-US', timeOptions)}`
}

// Helper function to get default datetime - consistent with base DatePicker
export const getDefaultDateTime = (): Date => {
  const defaultDate = new Date(2024, 0, 2, 11, 30, 0, 0)
  return defaultDate
}

export const getNextExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): Date[] => {
  if (data.mode === 'cron') {
    if (!data.cron_expression || !isValidCronExpression(data.cron_expression))
      return []
    return parseCronExpression(data.cron_expression, data.timezone).slice(0, count)
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

    // Get current time completely in user timezone
    const userCurrentTime = getUserTimezoneCurrentTime(data.timezone)

    let hour = userCurrentTime.getHours()
    if (userCurrentTime.getMinutes() >= onMinute)
      hour += 1 // Start from next hour if current minute has passed

    for (let i = 0; i < count; i++) {
      const execution = new Date(userToday)
      execution.setHours(hour + i, onMinute, 0, 0)
      // Handle day overflow
      if (hour + i >= 24) {
        execution.setDate(userToday.getDate() + Math.floor((hour + i) / 24))
        execution.setHours((hour + i) % 24, onMinute, 0, 0)
      }
      times.push(execution)
    }
  }
  else if (data.frequency === 'daily') {
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    // Check if today's configured time has already passed
    const todayExecution = new Date(userToday)
    todayExecution.setHours(displayHour, Number.parseInt(minute), 0, 0)

    const userCurrentTime = getUserTimezoneCurrentTime(data.timezone)

    const startOffset = todayExecution <= userCurrentTime ? 1 : 0

    for (let i = 0; i < count; i++) {
      const execution = new Date(userToday)
      execution.setDate(userToday.getDate() + startOffset + i)
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

    // Get current time completely in user timezone
    const userCurrentTime = getUserTimezoneCurrentTime(data.timezone)

    let executionCount = 0
    let weekOffset = 0

    while (executionCount < count) {
      let hasValidDays = false

      for (const selectedDay of selectedDays) {
        if (executionCount >= count) break

        const targetDay = dayMap[selectedDay as keyof typeof dayMap]
        if (targetDay === undefined) continue

        hasValidDays = true

        const currentDayOfWeek = userToday.getDay()
        const daysUntilTarget = (targetDay - currentDayOfWeek + 7) % 7

        // Check if today's configured time has already passed
        const todayAtTargetTime = new Date(userToday)
        todayAtTargetTime.setHours(displayHour, Number.parseInt(minute), 0, 0)

        let adjustedDays = daysUntilTarget
        if (daysUntilTarget === 0 && todayAtTargetTime <= userCurrentTime)
          adjustedDays = 7

        const execution = new Date(userToday)
        execution.setDate(userToday.getDate() + adjustedDays + (weekOffset * 7))
        execution.setHours(displayHour, Number.parseInt(minute), 0, 0)

        // Only add if execution time is in the future
        if (execution > userCurrentTime) {
          times.push(execution)
          executionCount++
        }
      }

      if (!hasValidDays) break
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

    // Get current time completely in user timezone
    const userCurrentTime = getUserTimezoneCurrentTime(data.timezone)

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

        // Only add if execution time is in the future
        if (execution > userCurrentTime)
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

export const formatExecutionTime = (date: Date, _timezone: string, includeWeekday: boolean = true): string => {
  return formatUserTimezoneDate(date, includeWeekday)
}

export const getFormattedExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): string[] => {
  const times = getNextExecutionTimes(data, count)

  return times.map((date) => {
    const includeWeekday = data.mode === 'visual' && data.frequency === 'weekly'
    return formatExecutionTime(date, data.timezone, includeWeekday)
  })
}

export const getNextExecutionTime = (data: ScheduleTriggerNodeType): string => {
  const times = getFormattedExecutionTimes(data, 1)
  if (times.length === 0) {
    const userCurrentTime = getUserTimezoneCurrentTime(data.timezone)
    const fallbackDate = new Date(userCurrentTime.getFullYear(), userCurrentTime.getMonth(), userCurrentTime.getDate(), 12, 0, 0, 0)
    const includeWeekday = data.mode === 'visual' && data.frequency === 'weekly'
    return formatExecutionTime(fallbackDate, data.timezone, includeWeekday)
  }
  return times[0]
}
