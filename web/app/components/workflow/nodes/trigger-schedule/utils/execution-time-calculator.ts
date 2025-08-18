import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'

// Helper function to get current time - timezone is handled by Date object natively
const getCurrentTime = (): Date => {
  return new Date()
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
    if (!data.visual_config?.datetime)
      return []

    const baseTime = new Date(data.visual_config.datetime)
    const recurUnit = data.visual_config?.recur_unit || 'hours'
    const recurEvery = data.visual_config?.recur_every || 1

    const intervalMs = recurUnit === 'hours'
      ? recurEvery * 60 * 60 * 1000
      : recurEvery * 60 * 1000

    for (let i = 0; i < count; i++) {
      const executionTime = new Date(baseTime.getTime() + i * intervalMs)
      times.push(executionTime)
    }
  }
  else if (data.frequency === 'daily') {
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime()
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
    const selectedDay = data.visual_config?.weekdays?.[0] || 'sun'
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
    const targetDay = dayMap[selectedDay as keyof typeof dayMap]

    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime()
    const currentDay = now.getDay()
    let daysUntilNext = (targetDay - currentDay + 7) % 7

    const nextExecutionBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), displayHour, Number.parseInt(minute), 0, 0)

    if (daysUntilNext === 0 && nextExecutionBase <= now)
      daysUntilNext = 7

    for (let i = 0; i < count; i++) {
      const nextExecution = new Date(nextExecutionBase)
      nextExecution.setDate(nextExecution.getDate() + daysUntilNext + (i * 7))
      times.push(nextExecution)
    }
  }
  else if (data.frequency === 'monthly') {
    const selectedDay = data.visual_config?.monthly_day || 1
    const [time, period] = defaultTime.split(' ')
    const [hour, minute] = time.split(':')
    let displayHour = Number.parseInt(hour)
    if (period === 'PM' && displayHour !== 12) displayHour += 12
    if (period === 'AM' && displayHour === 12) displayHour = 0

    const now = getCurrentTime()
    let monthOffset = 0

    const currentMonthExecution = (() => {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      let targetDay: number

      if (selectedDay === 'last') {
        const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
        targetDay = lastDayOfMonth
      }
 else {
        targetDay = Math.min(selectedDay as number, new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate())
      }

      return new Date(currentMonth.getFullYear(), currentMonth.getMonth(), targetDay, displayHour, Number.parseInt(minute), 0, 0)
    })()

    if (currentMonthExecution <= now)
      monthOffset = 1

    for (let i = 0; i < count; i++) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + i, 1)
      let targetDay: number

      if (selectedDay === 'last') {
        const lastDayOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
        targetDay = lastDayOfMonth
      }
 else {
        targetDay = Math.min(selectedDay as number, new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate())
      }

      const nextExecution = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), targetDay, displayHour, Number.parseInt(minute), 0, 0)
      times.push(nextExecution)
    }
  }
  else if (data.frequency === 'once') {
    // For 'once' frequency, return the selected datetime
    const selectedDateTime = data.visual_config?.datetime
    if (selectedDateTime)
      times.push(new Date(selectedDateTime))
  }
  else {
    // Fallback for unknown frequencies
    for (let i = 0; i < count; i++) {
      const now = getCurrentTime()
      const nextExecution = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1)
      times.push(nextExecution)
    }
  }

  return times
}

export const formatExecutionTime = (date: Date, includeWeekday: boolean = true): string => {
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

  // Always use local time for display to match calculation logic
  return `${date.toLocaleDateString('en-US', dateOptions)} ${date.toLocaleTimeString('en-US', timeOptions)}`
}

export const getFormattedExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): string[] => {
  const times = getNextExecutionTimes(data, count)

  return times.map((date) => {
    // Only weekly frequency includes weekday in format
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(date, includeWeekday)
  })
}

export const getNextExecutionTime = (data: ScheduleTriggerNodeType): string => {
  const times = getFormattedExecutionTimes(data, 1)
  if (times.length === 0) {
    if (data.frequency === 'once') {
      const defaultDate = getDefaultDateTime()
      return formatExecutionTime(defaultDate, false)
    }
    const now = getCurrentTime()
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(now, includeWeekday)
  }
  return times[0]
}
