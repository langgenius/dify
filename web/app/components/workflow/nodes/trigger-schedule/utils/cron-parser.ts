import { CronExpressionParser } from 'cron-parser'

// Convert a UTC date from cron-parser to user timezone representation
// This ensures consistency with other execution time calculations
const convertToUserTimezoneRepresentation = (utcDate: Date, timezone: string): Date => {
  // Get the time string in the target timezone
  const userTimeStr = utcDate.toLocaleString('en-CA', {
    timeZone: timezone,
    hour12: false,
  })
  const [dateStr, timeStr] = userTimeStr.split(', ')
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute, second] = timeStr.split(':').map(Number)

  // Create a new Date object representing this time as "local" time
  // This matches the behavior expected by the execution-time-calculator
  return new Date(year, month - 1, day, hour, minute, second)
}

/**
 * Parse a cron expression and return the next 5 execution times
 *
 * @param cronExpression - Standard 5-field cron expression (minute hour day month dayOfWeek)
 * @param timezone - IANA timezone identifier (e.g., 'UTC', 'America/New_York')
 * @returns Array of Date objects representing the next 5 execution times
 */
export const parseCronExpression = (cronExpression: string, timezone: string = 'UTC'): Date[] => {
  if (!cronExpression || cronExpression.trim() === '')
    return []

  const parts = cronExpression.trim().split(/\s+/)

  // Support both 5-field format and predefined expressions
  if (parts.length !== 5 && !cronExpression.startsWith('@'))
    return []

  try {
    // Parse the cron expression with timezone support
    // Use the actual current time for cron-parser to handle properly
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
    })

    // Get the next 5 execution times using the take() method
    const nextCronDates = interval.take(5)

    // Convert CronDate objects to Date objects and ensure they represent
    // the time in user timezone (consistent with execution-time-calculator.ts)
    return nextCronDates.map((cronDate) => {
      const utcDate = cronDate.toDate()
      return convertToUserTimezoneRepresentation(utcDate, timezone)
    })
  }
  catch {
    // Return empty array if parsing fails
    return []
  }
}

/**
 * Validate a cron expression format and syntax
 *
 * @param cronExpression - Standard 5-field cron expression to validate
 * @returns boolean indicating if the cron expression is valid
 */
export const isValidCronExpression = (cronExpression: string): boolean => {
  if (!cronExpression || cronExpression.trim() === '')
    return false

  const parts = cronExpression.trim().split(/\s+/)

  // Support both 5-field format and predefined expressions
  if (parts.length !== 5 && !cronExpression.startsWith('@'))
    return false

  try {
    // Use cron-parser to validate the expression
    CronExpressionParser.parse(cronExpression)
    return true
  }
  catch {
    return false
  }
}
