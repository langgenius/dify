const matchesField = (value: number, pattern: string, min: number, max: number): boolean => {
  if (pattern === '*') return true

  if (pattern.includes(','))
    return pattern.split(',').some(p => matchesField(value, p.trim(), min, max))

  if (pattern.includes('/')) {
    const [range, step] = pattern.split('/')
    const stepValue = Number.parseInt(step, 10)
    if (Number.isNaN(stepValue)) return false

    if (range === '*') {
      return value % stepValue === min % stepValue
    }
 else {
      const rangeStart = Number.parseInt(range, 10)
      if (Number.isNaN(rangeStart)) return false
      return value >= rangeStart && (value - rangeStart) % stepValue === 0
    }
  }

  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(p => Number.parseInt(p.trim(), 10))
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    return value >= start && value <= end
  }

  const numValue = Number.parseInt(pattern, 10)
  if (Number.isNaN(numValue)) return false
  return value === numValue
}

const expandCronField = (field: string, min: number, max: number): number[] => {
  if (field === '*')
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)

  if (field.includes(','))
    return field.split(',').flatMap(p => expandCronField(p.trim(), min, max))

  if (field.includes('/')) {
    const [range, step] = field.split('/')
    const stepValue = Number.parseInt(step, 10)
    if (Number.isNaN(stepValue)) return []

    const baseValues = range === '*' ? [min] : expandCronField(range, min, max)
    const result: number[] = []

    for (let start = baseValues[0]; start <= max; start += stepValue) {
      if (start >= min && start <= max)
        result.push(start)
    }
    return result
  }

  if (field.includes('-')) {
    const [start, end] = field.split('-').map(p => Number.parseInt(p.trim(), 10))
    if (Number.isNaN(start) || Number.isNaN(end)) return []

    const result: number[] = []
    for (let i = start; i <= end && i <= max; i++)
      if (i >= min) result.push(i)

    return result
  }

  const numValue = Number.parseInt(field, 10)
  return !Number.isNaN(numValue) && numValue >= min && numValue <= max ? [numValue] : []
}

const matchesCron = (
  date: Date,
  minute: string,
  hour: string,
  dayOfMonth: string,
  month: string,
  dayOfWeek: string,
): boolean => {
  const currentMinute = date.getMinutes()
  const currentHour = date.getHours()
  const currentDay = date.getDate()
  const currentMonth = date.getMonth() + 1
  const currentDayOfWeek = date.getDay()

  // Basic time matching
  if (!matchesField(currentMinute, minute, 0, 59)) return false
  if (!matchesField(currentHour, hour, 0, 23)) return false
  if (!matchesField(currentMonth, month, 1, 12)) return false

  // Day matching logic: if both dayOfMonth and dayOfWeek are specified (not *),
  // the cron should match if EITHER condition is true (OR logic)
  const dayOfMonthSpecified = dayOfMonth !== '*'
  const dayOfWeekSpecified = dayOfWeek !== '*'

  if (dayOfMonthSpecified && dayOfWeekSpecified) {
    // If both are specified, match if either matches
    return matchesField(currentDay, dayOfMonth, 1, 31)
           || matchesField(currentDayOfWeek, dayOfWeek, 0, 6)
  }
 else if (dayOfMonthSpecified) {
    // Only day of month specified
    return matchesField(currentDay, dayOfMonth, 1, 31)
  }
 else if (dayOfWeekSpecified) {
    // Only day of week specified
    return matchesField(currentDayOfWeek, dayOfWeek, 0, 6)
  }
 else {
    // Both are *, matches any day
    return true
  }
}

export const parseCronExpression = (cronExpression: string): Date[] => {
  if (!cronExpression || cronExpression.trim() === '')
    return []

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5)
    return []

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  try {
    const nextTimes: Date[] = []
    const now = new Date()

    // Start from next minute
    const startTime = new Date(now)
    startTime.setMinutes(startTime.getMinutes() + 1)
    startTime.setSeconds(0, 0)

    // For monthly expressions (like "15 10 1 * *"), we need to check more months
    // For weekly expressions, we need to check more weeks
    // Use a smarter approach: check up to 12 months for monthly patterns
    const isMonthlyPattern = dayOfMonth !== '*' && dayOfWeek === '*'
    const isWeeklyPattern = dayOfMonth === '*' && dayOfWeek !== '*'

    let searchMonths = 12
    if (isWeeklyPattern) searchMonths = 3 // 3 months should cover 12+ weeks
    else if (!isMonthlyPattern) searchMonths = 2 // For daily/hourly patterns

    // Check across multiple months
    for (let monthOffset = 0; monthOffset < searchMonths && nextTimes.length < 5; monthOffset++) {
      const checkMonth = new Date(startTime.getFullYear(), startTime.getMonth() + monthOffset, 1)

      // Get the number of days in this month
      const daysInMonth = new Date(checkMonth.getFullYear(), checkMonth.getMonth() + 1, 0).getDate()

      // Check each day in this month
      for (let day = 1; day <= daysInMonth && nextTimes.length < 5; day++) {
        const checkDate = new Date(checkMonth.getFullYear(), checkMonth.getMonth(), day)

        // For each day, check the specific hour and minute from cron
        // This is more efficient than checking all hours/minutes
        if (minute !== '*' && hour !== '*') {
          // Extract specific minute and hour values
          const minuteValues = expandCronField(minute, 0, 59)
          const hourValues = expandCronField(hour, 0, 23)

          for (const h of hourValues) {
            for (const m of minuteValues) {
              checkDate.setHours(h, m, 0, 0)

              // Skip if this time is before our start time
              if (checkDate <= now) continue

              if (matchesCron(checkDate, minute, hour, dayOfMonth, month, dayOfWeek))
                nextTimes.push(new Date(checkDate))
            }
          }
        }
 else {
          // Fallback for complex expressions with wildcards
          for (let h = 0; h < 24 && nextTimes.length < 5; h++) {
            for (let m = 0; m < 60 && nextTimes.length < 5; m++) {
              checkDate.setHours(h, m, 0, 0)

              if (checkDate <= now) continue

              if (matchesCron(checkDate, minute, hour, dayOfMonth, month, dayOfWeek))
                nextTimes.push(new Date(checkDate))
            }
          }
        }
      }
    }

    return nextTimes.sort((a, b) => a.getTime() - b.getTime()).slice(0, 5)
  }
 catch {
    return []
  }
}

const isValidCronField = (field: string, min: number, max: number): boolean => {
  if (field === '*') return true

  if (field.includes(','))
    return field.split(',').every(p => isValidCronField(p.trim(), min, max))

  if (field.includes('/')) {
    const [range, step] = field.split('/')
    const stepValue = Number.parseInt(step, 10)
    if (Number.isNaN(stepValue) || stepValue <= 0) return false

    if (range === '*') return true
    return isValidCronField(range, min, max)
  }

  if (field.includes('-')) {
    const [start, end] = field.split('-').map(p => Number.parseInt(p.trim(), 10))
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    return start >= min && end <= max && start <= end
  }

  const numValue = Number.parseInt(field, 10)
  return !Number.isNaN(numValue) && numValue >= min && numValue <= max
}

export const isValidCronExpression = (cronExpression: string): boolean => {
  if (!cronExpression || cronExpression.trim() === '')
    return false

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5)
    return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  return (
    isValidCronField(minute, 0, 59)
    && isValidCronField(hour, 0, 23)
    && isValidCronField(dayOfMonth, 1, 31)
    && isValidCronField(month, 1, 12)
    && isValidCronField(dayOfWeek, 0, 6)
  )
}
