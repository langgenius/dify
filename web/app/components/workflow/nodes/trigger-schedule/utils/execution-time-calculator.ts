import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'
import { createTimezoneConverterForSchedule } from './timezone-converter'

/**
 * Enhanced execution time calculator using unified timezone converter
 *
 * This refactored version eliminates timezone conversion logic from this file
 * and delegates all timezone operations to the unified TimezoneConverter.
 *
 * Key improvements:
 * - Single source of truth for timezone conversions
 * - Consistent handling of both UTC and user format times
 * - Proper integration with user profile timezone settings
 */
export const getDefaultDateTime = (): Date => {
  const defaultDate = new Date()
  defaultDate.setHours(11, 30, 0, 0)
  defaultDate.setDate(defaultDate.getDate() + 1)
  return defaultDate
}

/**
 * Timezone-aware cron expression parser
 *
 * This function parses cron expressions with proper timezone awareness:
 * 1. Uses user timezone for current time calculation
 * 2. Creates execution times in user timezone
 * 3. Properly filters past times based on user timezone
 * 4. Returns execution times as UTC Date objects
 */
const parseCronExpressionWithTimezone = (
  cronExpression: string,
  converter: ReturnType<typeof createTimezoneConverterForSchedule>,
  count: number = 5,
): Date[] => {
  if (!cronExpression || cronExpression.trim() === '')
    return []

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5)
    return []

  try {
    // Use system cron parser to get base execution times
    const systemTimes = parseCronExpression(cronExpression)

    if (systemTimes.length === 0)
      return []

    // Get current user time for proper filtering
    const nowUserTime = converter.getCurrentUserTime()
    const filteredTimes: Date[] = []

    // Process each system time with proper timezone handling
    for (const systemTime of systemTimes) {
      if (filteredTimes.length >= count) break

      // Extract the time components from the cron-generated time
      const cronHour = systemTime.getHours()
      const cronMinute = systemTime.getMinutes()
      const cronDate = systemTime.getDate()
      const cronMonth = systemTime.getMonth()
      const cronYear = systemTime.getFullYear()

      // Create execution time in user timezone
      const userExecutionTime = new Date(cronYear, cronMonth, cronDate, cronHour, cronMinute, 0, 0)

      // Filter: only include times that haven't passed in user timezone
      if (userExecutionTime > nowUserTime) {
        // For UTC timezone, no conversion needed - use the time as is
        if (converter.getUserTimezone() === 'UTC') {
          const utcTime = new Date(Date.UTC(cronYear, cronMonth, cronDate, cronHour, cronMinute, 0, 0))
          filteredTimes.push(utcTime)
        }
 else {
          // For other timezones, convert using the timezone converter
          const userTimeStr = `${cronHour % 12 || 12}:${cronMinute.toString().padStart(2, '0')} ${cronHour >= 12 ? 'PM' : 'AM'}`
          const utcTime = converter.toUTC(userTimeStr)
          const [utcHour, utcMinute] = utcTime.split(':')

          const finalExecutionTime = new Date(Date.UTC(
            cronYear,
            cronMonth,
            cronDate,
            Number.parseInt(utcHour, 10),
            Number.parseInt(utcMinute, 10),
            0,
            0,
          ))

          filteredTimes.push(finalExecutionTime)
        }
      }
    }

    return filteredTimes.sort((a, b) => a.getTime() - b.getTime()).slice(0, count)
  }
 catch {
    return []
  }
}

export const getNextExecutionTimes = (
  data: ScheduleTriggerNodeType,
  count: number = 5,
  userProfile?: { timezone?: string },
): Date[] => {
  if (data.mode === 'cron') {
    if (!data.cron_expression || !isValidCronExpression(data.cron_expression))
      return []

    // Create timezone converter for cron mode
    const converter = createTimezoneConverterForSchedule(userProfile, data.timezone)

    // Parse cron with timezone awareness
    return parseCronExpressionWithTimezone(
      data.cron_expression,
      converter,
      count,
    )
  }

  // Create timezone converter with proper user profile integration
  const converter = createTimezoneConverterForSchedule(userProfile, data.timezone)

  const times: Date[] = []
  const configuredTime = data.visual_config?.time || '11:30 AM'

  // Ensure we have user format time for consistent parsing
  // Convert from UTC to user format if needed for internal calculations
  const userFormatTime = converter.isUTCFormat(configuredTime)
    ? converter.fromUTC(configuredTime)
    : configuredTime

  if (data.frequency === 'hourly') {
    const onMinute = data.visual_config?.on_minute ?? 0
    const now = converter.getCurrentUserTime()
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
    // Parse user format time using consistent logic
    const [time, period] = userFormatTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour, 10)

    // Convert to 24-hour format
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = converter.getCurrentUserTime()

    // Create today's execution time in user timezone
    const todayExecution = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      displayHour,
      Number.parseInt(minute, 10),
      0,
      0,
    )

    // Calculate initial offset: if time has passed today, start from tomorrow
    // Compare user timezone times to avoid timezone confusion
    const initialOffset = todayExecution <= now ? 1 : 0

    // Convert to UTC for final execution times
    const utcTimeForExecution = converter.toUTC(`${displayHour % 12 || 12}:${minute} ${displayHour >= 12 ? 'PM' : 'AM'}`)
    const [utcHour, utcMinute] = utcTimeForExecution.split(':')

    const baseExecution = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number.parseInt(utcHour, 10),
      Number.parseInt(utcMinute, 10),
      0,
      0,
    ))

    for (let i = 0; i < count; i++) {
      const nextExecution = new Date(baseExecution)
      nextExecution.setUTCDate(baseExecution.getUTCDate() + initialOffset + i)
      times.push(nextExecution)
    }
  }
  else if (data.frequency === 'weekly') {
    const selectedDays = data.visual_config?.weekdays || ['sun']
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

    // Parse user format time using consistent logic
    const [time, period] = userFormatTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour, 10)

    // Convert to 24-hour format
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = converter.getCurrentUserTime()

    // Convert user time to UTC for proper execution scheduling
    const utcTimeForExecution = converter.toUTC(`${displayHour % 12 || 12}:${minute} ${displayHour >= 12 ? 'PM' : 'AM'}`)
    const [utcHour, utcMinute] = utcTimeForExecution.split(':')

    let weekOffset = 0

    // Check if any execution is possible in current week
    const currentWeekExecutions: Date[] = []
    for (const selectedDay of selectedDays) {
      const targetDay = dayMap[selectedDay as keyof typeof dayMap]
      let daysUntilNext = (targetDay - now.getDay() + 7) % 7

      const nextExecutionBase = new Date(Date.UTC(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number.parseInt(utcHour, 10),
        Number.parseInt(utcMinute, 10),
        0,
        0,
      ))

      if (daysUntilNext === 0 && nextExecutionBase <= new Date())
        daysUntilNext = 7

      if (daysUntilNext < 7) {
        const execution = new Date(nextExecutionBase)
        execution.setUTCDate(execution.getUTCDate() + daysUntilNext)
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
        const execution = new Date(Date.UTC(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          Number.parseInt(utcHour, 10),
          Number.parseInt(utcMinute, 10),
          0,
          0,
        ))
        execution.setUTCDate(execution.getUTCDate() + (targetDay - now.getDay() + 7) % 7 + (weekOffset + weeksChecked) * 7)

        if (execution > new Date())
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

    // Parse user format time using consistent logic
    const [time, period] = userFormatTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour, 10)

    // Convert to 24-hour format
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = converter.getCurrentUserTime()
    let monthOffset = 0

    // Check if any execution is possible in current month
    const hasValidCurrentMonthExecution = selectedDays.some((selectedDay) => {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()

      let targetDay: number
      if (selectedDay === 'last') {
        targetDay = daysInMonth
      }
 else {
        const dayNumber = selectedDay as number
        if (dayNumber > daysInMonth)
          return false

        targetDay = dayNumber
      }

      // Convert user time to UTC for proper execution scheduling
      const utcTimeForExecution = converter.toUTC(`${displayHour % 12 || 12}:${minute} ${displayHour >= 12 ? 'PM' : 'AM'}`)
      const [utcHour, utcMinute] = utcTimeForExecution.split(':')

      const execution = new Date(Date.UTC(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        targetDay,
        Number.parseInt(utcHour, 10),
        Number.parseInt(utcMinute, 10),
        0,
        0,
      ))
      return execution > new Date()
    })

    if (!hasValidCurrentMonthExecution)
      monthOffset = 1

    let monthsChecked = 0

    while (times.length < count && monthsChecked < 24) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + monthsChecked, 1)
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

        // Convert user time to UTC for proper execution scheduling
        const utcTimeForExecution = converter.toUTC(`${displayHour % 12 || 12}:${minute} ${displayHour >= 12 ? 'PM' : 'AM'}`)
        const [utcHour, utcMinute] = utcTimeForExecution.split(':')

        const nextExecution = new Date(Date.UTC(
          targetMonth.getFullYear(),
          targetMonth.getMonth(),
          targetDay,
          Number.parseInt(utcHour, 10),
          Number.parseInt(utcMinute, 10),
          0,
          0,
        ))

        if (nextExecution > new Date())
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
    // Fallback for unknown frequencies - use converter for consistency
    const now = converter.getCurrentUserTime()
    for (let i = 0; i < count; i++) {
      const nextExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1)
      times.push(nextExecution)
    }
  }

  return times
}

export const formatExecutionTime = (
  date: Date,
  timezone: string,
  includeWeekday: boolean = true,
  userProfile?: { timezone?: string },
): string => {
  // Use unified timezone converter for consistent formatting
  const converter = createTimezoneConverterForSchedule(userProfile, timezone)
  return converter.formatExecutionTime(date, includeWeekday)
}

export const getFormattedExecutionTimes = (
  data: ScheduleTriggerNodeType,
  count: number = 5,
  userProfile?: { timezone?: string },
): string[] => {
  const times = getNextExecutionTimes(data, count, userProfile)
  const converter = createTimezoneConverterForSchedule(userProfile, data.timezone)

  return times.map((date) => {
    const includeWeekday = data.frequency === 'weekly'
    return converter.formatExecutionTime(date, includeWeekday)
  })
}

export const getNextExecutionTime = (
  data: ScheduleTriggerNodeType,
  userProfile?: { timezone?: string },
): string => {
  const times = getFormattedExecutionTimes(data, 1, userProfile)
  if (times.length === 0) {
    const converter = createTimezoneConverterForSchedule(userProfile, data.timezone)
    const now = converter.getCurrentUserTime()
    const includeWeekday = data.frequency === 'weekly'
    return converter.formatExecutionTime(now, includeWeekday)
  }
  return times[0]
}
