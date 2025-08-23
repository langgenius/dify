import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

// Initialize dayjs plugins
dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Unified Timezone Converter - Single source of truth for all timezone operations
 *
 * This class serves as the central middleware for timezone conversions in the schedule trigger system.
 * It follows the principle: UI displays user timezone ←→ Unified Converter ←→ UTC storage
 *
 * Design principles:
 * - All timezone conversions go through this single class
 * - UTC is the single source of truth for storage
 * - User timezone is the single source of truth for display
 * - No timezone logic should exist outside this converter
 * - Integrates seamlessly with project's user timezone system (useAppContext)
 */
export class TimezoneConverter {
  private readonly userTimezone: string

  constructor(userTimezone: string) {
    // Follow the same fallback logic as the project's use-config.ts
    const candidate = userTimezone && userTimezone.trim() ? userTimezone : this.getSystemTimezone()
    this.userTimezone = this.validateTimezone(candidate) ? candidate : this.getSystemTimezone()
  }

  /**
   * Get system timezone as fallback, matching project's logic
   * @private
   */
  private getSystemTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    }
 catch {
      return 'UTC'
    }
  }

  /**
   * Validate timezone identifier
   * @private
   */
  private validateTimezone(timezone: string): boolean {
    try {
      // Test if timezone is valid by attempting to create a date with it
      dayjs().tz(timezone)
      return true
    }
 catch {
      return false
    }
  }

  /**
   * Convert user time format to UTC for storage
   * @param userTime - Time in user format (e.g., "2:30 PM")
   * @returns UTC time in 24h format (e.g., "14:30")
   */
  toUTC(userTime: string): string {
    if (this.userTimezone === 'UTC')
      return this.convertTo24HourFormat(userTime)

    try {
      const timeParts = userTime.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
      if (!timeParts)
        return userTime // Return as-is if format is invalid

      let hour = Number.parseInt(timeParts[1], 10)
      const minute = Number.parseInt(timeParts[2], 10)
      const period = timeParts[3].toUpperCase()

      // Convert to 24-hour format
      if (period === 'PM' && hour !== 12) hour += 12
      if (period === 'AM' && hour === 12) hour = 0

      // Create datetime in user timezone and convert to UTC
      // Use current date to ensure proper DST handling
      const currentDate = dayjs().format('YYYY-MM-DD')
      const userDateTime = dayjs.tz(
        `${currentDate} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        'YYYY-MM-DD HH:mm',
        this.userTimezone,
      )

      return userDateTime.utc().format('HH:mm')
    }
 catch (error) {
      console.warn('Failed to convert user time to UTC:', error)
      return userTime
    }
  }

  /**
   * Convert UTC time to user timezone format for display
   * @param utcTime - UTC time in 24h format (e.g., "14:30")
   * @returns User time in 12h format (e.g., "2:30 PM")
   */
  fromUTC(utcTime: string): string {
    if (this.userTimezone === 'UTC')
      return this.convertTo12HourFormat(utcTime)

    try {
      // Parse UTC time and convert to user timezone
      // Use current date to ensure proper DST handling
      const currentDate = dayjs().format('YYYY-MM-DD')
      const utcDateTime = dayjs.utc(`${currentDate} ${utcTime}`, 'YYYY-MM-DD HH:mm')
      return utcDateTime.tz(this.userTimezone).format('h:mm A')
    }
 catch (error) {
      console.warn('Failed to convert UTC time to user timezone:', error)
      return utcTime
    }
  }

  /**
   * Get current time in user timezone
   * This method provides the current time adjusted for the user's timezone,
   * which is essential for execution time calculations.
   *
   * @returns Date object representing current time in user timezone
   */
  getCurrentUserTime(): Date {
    if (this.userTimezone === 'UTC')
      return new Date()

    try {
      return dayjs().tz(this.userTimezone).toDate()
    }
 catch (error) {
      console.warn('Failed to get current time in user timezone:', error)
      return new Date()
    }
  }

  /**
   * Format execution time for display in user timezone
   * @param date - Date object to format
   * @param includeWeekday - Whether to include weekday in the format
   * @returns Formatted string in user timezone
   */
  formatExecutionTime(date: Date, includeWeekday: boolean = true): string {
    try {
      const dateOptions: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: this.userTimezone,
      }

      if (includeWeekday)
        dateOptions.weekday = 'short'

      const timeOptions: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: this.userTimezone,
      }

      return `${date.toLocaleDateString('en-US', dateOptions)} ${date.toLocaleTimeString('en-US', timeOptions)}`
    }
    catch {
      return date.toLocaleString()
    }
  }

  /**
   * Get user timezone identifier
   * @returns The timezone identifier being used
   */
  getUserTimezone(): string {
    return this.userTimezone
  }

  /**
   * Check if a time string is in UTC format (24h)
   * @param time - Time string to check
   * @returns True if in UTC format
   */
  isUTCFormat(time: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(time))
      return false

    // Validate hour and minute ranges
    const [hourStr, minuteStr] = time.split(':')
    const hour = Number.parseInt(hourStr, 10)
    const minute = Number.parseInt(minuteStr, 10)

    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
  }

  /**
   * Check if a time string is in user format (12h with AM/PM)
   * @param time - Time string to check
   * @returns True if in user format
   */
  isUserFormat(time: string): boolean {
    if (!/^\d{1,2}:\d{2} (AM|PM)$/i.test(time))
      return false

    // Validate hour and minute ranges for 12-hour format
    const match = time.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (!match) return false

    const hour = Number.parseInt(match[1], 10)
    const minute = Number.parseInt(match[2], 10)

    return hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59
  }

  /**
   * Convert 12-hour format to 24-hour format for UTC timezone
   * @private
   */
  private convertTo24HourFormat(time: string): string {
    const timeParts = time.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
    if (!timeParts) return time

    let hour = Number.parseInt(timeParts[1], 10)
    const minute = timeParts[2]
    const period = timeParts[3].toUpperCase()

    // Validate input ranges
    if (hour < 1 || hour > 12) return time
    if (Number.parseInt(minute, 10) < 0 || Number.parseInt(minute, 10) > 59) return time

    if (period === 'PM' && hour !== 12) hour += 12
    if (period === 'AM' && hour === 12) hour = 0

    return `${hour.toString().padStart(2, '0')}:${minute}`
  }

  /**
   * Convert 24-hour format to 12-hour format for UTC timezone
   * @private
   */
  private convertTo12HourFormat(time: string): string {
    const [hour, minute] = time.split(':')
    const hourNum = Number.parseInt(hour, 10)
    let displayHour = hourNum

    if (hourNum > 12)
      displayHour = hourNum - 12
     else if (hourNum === 0)
      displayHour = 12

    const period = hourNum >= 12 ? 'PM' : 'AM'
    return `${displayHour}:${minute} ${period}`
  }
}

/**
 * Factory function to create a timezone converter instance
 * @param userTimezone - User's timezone identifier
 * @returns TimezoneConverter instance
 */
export function createTimezoneConverter(userTimezone: string): TimezoneConverter {
  return new TimezoneConverter(userTimezone)
}

/**
 * Factory function that integrates with the project's user timezone system
 * This matches the exact logic used in use-config.ts for timezone resolution
 *
 * @param userProfile - User profile from useAppContext (can be undefined)
 * @param payloadTimezone - Timezone from schedule payload (fallback)
 * @returns TimezoneConverter instance with proper timezone resolution
 */
export function createTimezoneConverterFromUserProfile(
  userProfile?: { timezone?: string },
  payloadTimezone?: string,
): TimezoneConverter {
  // Follow exact same logic as use-config.ts line 18
  const resolvedTimezone = userProfile?.timezone || payloadTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  return new TimezoneConverter(resolvedTimezone)
}

/**
 * Hook-like factory for React components that need timezone conversion
 * This integrates directly with useAppContext pattern used throughout the project
 *
 * Usage example:
 * ```typescript
 * const { userProfile } = useAppContext()
 * const converter = createTimezoneConverterForSchedule(userProfile, payload.timezone)
 * ```
 */
export function createTimezoneConverterForSchedule(
  userProfile?: { timezone?: string },
  scheduleTimezone?: string,
): TimezoneConverter {
  return createTimezoneConverterFromUserProfile(userProfile, scheduleTimezone)
}
