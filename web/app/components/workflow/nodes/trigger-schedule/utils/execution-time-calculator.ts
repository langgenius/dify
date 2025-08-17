import type { ScheduleTriggerNodeType } from '../types'
import { isValidCronExpression, parseCronExpression } from './cron-parser'

// Helper function to get current time - timezone is handled by Date object natively
const getCurrentTime = (): Date => {
  return new Date()
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
    const recurEvery = data.visual_config?.recur_every || 1
    const recurUnit = data.visual_config?.recur_unit || 'hours'
    const startTime = data.visual_config?.datetime ? new Date(data.visual_config.datetime) : getCurrentTime()

    const intervalMs = recurUnit === 'hours'
      ? recurEvery * 60 * 60 * 1000
      : recurEvery * 60 * 1000

    // Calculate the initial offset if start time has passed
    const now = getCurrentTime()
    let initialOffset = 0

    if (startTime <= now) {
      const timeDiff = now.getTime() - startTime.getTime()
      initialOffset = Math.floor(timeDiff / intervalMs)
    }

    for (let i = 0; i < count; i++) {
      const nextExecution = new Date(startTime.getTime() + (initialOffset + i + 1) * intervalMs)
      times.push(nextExecution)
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

    for (let i = 0; i < count; i++) {
      const today = getCurrentTime()
      const currentDay = today.getDay()
      const daysUntilNext = (targetDay - currentDay + 7) % 7

      const nextExecution = new Date(today.getFullYear(), today.getMonth(), today.getDate(), displayHour, Number.parseInt(minute), 0, 0)

      let finalDate = today.getDate() + daysUntilNext + (i * 7)
      if (i === 0 && daysUntilNext === 0 && nextExecution <= today)
        finalDate += 7

      nextExecution.setDate(finalDate)
      times.push(nextExecution)
    }
  }
  else {
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
    const now = getCurrentTime()
    const includeWeekday = data.frequency === 'weekly'
    return formatExecutionTime(now, includeWeekday)
  }
  return times[0]
}
