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

  return (
    matchesField(currentMinute, minute, 0, 59)
    && matchesField(currentHour, hour, 0, 23)
    && matchesField(currentDay, dayOfMonth, 1, 31)
    && matchesField(currentMonth, month, 1, 12)
    && matchesField(currentDayOfWeek, dayOfWeek, 0, 6)
  )
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
    const checkDate = new Date(now)

    for (let i = 0; i < 100 && nextTimes.length < 5; i++) {
      checkDate.setMinutes(checkDate.getMinutes() + 1)

      if (matchesCron(checkDate, minute, hour, dayOfMonth, month, dayOfWeek))
        nextTimes.push(new Date(checkDate))
    }

    return nextTimes
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
