import type { WallTime } from './time-model'
import { CronExpressionParser } from 'cron-parser'
import {
  dayOfWeek,
  daysInMonth,
  offsetMinutesAt,
  toInstants,
  toWallMs,
  wallFromUtcMs,
  wallToUtcMs,
} from './time-model'

// Next runs follow the backend scheduler, which uses croniter 6 with zoneinfo.
// The parsing and the search below follow croniter step by step, so odd syntax
// (for example "5-5" meaning the whole range) gives the same runs as the backend.
// Clock readings are kept as UTC-based milliseconds with no timezone ("wall ms").

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
// croniter gives up after this many years without a match.
const MAX_YEARS_BETWEEN_MATCHES = 50

const MINUTE = 0
const HOUR = 1
const DAY = 2
const MONTH = 3
const WEEKDAY = 4

const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
]
const LEN_MEANS_ALL = [60, 24, 31, 12, 7]

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const NAMES: ReadonlyArray<ReadonlyMap<string, number | 'l'>> = [
  new Map(),
  new Map(),
  new Map([['l', 'l']]),
  new Map(MONTH_NAMES.map((name, index) => [name, index + 1])),
  new Map(WEEKDAY_NAMES.map((name, index) => [name, index])),
]

const ALIASES = new Map([
  ['@midnight', '0 0 * * *'],
  ['@hourly', '0 * * * *'],
  ['@daily', '0 0 * * *'],
  ['@weekly', '0 0 * * 0'],
  ['@monthly', '0 0 1 * *'],
  ['@yearly', '0 0 1 1 *'],
  ['@annually', '0 0 1 1 *'],
])

const STEP_RE = /^([^-]+)-([^-/]+)(?:\/(\d+))?$/
const ONLY_INT_RE = /^\d+$/
const STAR_OR_INT_RE = /^(?:\d+|\*)$/
const WEEKDAYS = WEEKDAY_NAMES.join('|')
const MONTHS = MONTH_NAMES.join('|')
// Day of week "2#3" (third Tuesday) and "l3" (last Wednesday), same pattern as croniter.
const SPECIAL_WEEKDAY_RE = new RegExp(
  `^(?:(?<he>(?:${WEEKDAYS})(?:-(?:${WEEKDAYS}))?|(?:${MONTHS})(?:-(?:${MONTHS}))?|\\w+)#|l)` +
    `(?<last>\\d+)$`,
)
const NEAREST_WEEKDAY_RE = /^(?:(\d+)w|w(\d+))$/
const HASH_RE = /^[hr](?:\(\d+-\d+\))?(?:\/\d+)?$/

type FieldValue = number | 'l' | '*'
type Nth = number | 'l'

type CronSpec = {
  fields: FieldValue[][]
  nthWeekdays: Map<number, Set<Nth>>
  nearestWeekdays: number[]
}

class CronError extends Error {}

const pythonRange = (start: number, stop: number, step: number): number[] => {
  if (step <= 0) throw new CronError('bad step')
  const values: number[] = []
  for (let value = start; value < stop; value += step) values.push(value)
  return values
}

const nameToValue = (index: number, key: string): number | 'l' => {
  const value = NAMES[index]!.get(key)
  if (value === undefined) throw new CronError(`unknown name ${key}`)
  return value
}

// croniter maps day of week 7 to 0. Day of month and month 0 are not mapped for 5 fields.
const valueAlias = (value: FieldValue, index: number): FieldValue =>
  index === WEEKDAY && value === 7 ? 0 : value

// croniter sorts with the key f"{value:02}".
const sortKey = (value: FieldValue) =>
  typeof value === 'number' ? String(value).padStart(2, '0') : `${value}0`

const expandField = (index: number, rawExpr: string, expressions: string[], spec: CronSpec) => {
  const [low, high] = RANGES[index]!
  let expr = rawExpr

  // Hashed (H) fields need a hash id and random (R) fields cannot be previewed.
  if (HASH_RE.test(expr)) throw new CronError('hash syntax')

  if (expr.includes('?')) {
    if (expr !== '?' || (index !== DAY && index !== WEEKDAY))
      throw new CronError('bad question mark')
    expr = '*'
  }

  const list: (string | number)[] = expr.split(',')
  const result: FieldValue[] = []

  while (list.length > 0) {
    let entry = list.pop()!
    let nth: Nth | null = null

    if (index === WEEKDAY) {
      const match = SPECIAL_WEEKDAY_RE.exec(String(entry))
      if (match) {
        const { he, last } = match.groups!
        if (he) {
          entry = he
          nth = Number(last)
          if (!(nth >= 1 && nth <= 5)) throw new CronError('bad nth')
        } else if (last) {
          entry = last
          nth = 'l'
        }
      }
    }

    if (index === DAY) {
      const match = NEAREST_WEEKDAY_RE.exec(String(entry))
      if (match) {
        const day = Number(match[1] ?? match[2])
        if (day < 1 || day > 31) throw new CronError('bad W day')
        if (list.length > 0 || result.length > 0) throw new CronError('W in a list')
        spec.nearestWeekdays.push(day)
        result.push(day)
        continue
      }
    }

    let text = String(entry).replace(/^\*(\/.+)$/, `${low}-${high}$1`)
    let match = STEP_RE.exec(text)
    if (!match) {
      // "10/5" becomes "10-59/5". Same as croniter's "^(.+)/(.+)$": split at the last "/"
      // that has text on both sides.
      text = String(entry)
      const slash = text.lastIndexOf('/', text.length - 2)
      if (slash > 0) text = `${text.slice(0, slash)}-${high}/${text.slice(slash + 1)}`
      match = STEP_RE.exec(text)
    }

    if (match) {
      let lowText: string = match[1]!
      let highText: string = match[2]!
      const stepText = match[3] ?? '1'
      if (index === DAY && highText === 'l') highText = '31'
      if (!ONLY_INT_RE.test(lowText)) lowText = String(nameToValue(index, lowText))
      if (!ONLY_INT_RE.test(highText)) highText = String(nameToValue(index, highText))
      if (!ONLY_INT_RE.test(lowText) || !ONLY_INT_RE.test(highText))
        throw new CronError('bad range')
      const step = Number(stepText)
      const from = valueAlias(Number(lowText), index) as number
      const to = valueAlias(Number(highText), index) as number
      if (Math.max(from, to) > Math.max(low, high)) throw new CronError('out of range')

      let values: number[]
      if (from > to) {
        // A range that wraps around, like fri-mon. The step carries over the wrap.
        values = pythonRange(from, high + 1, step)
        let toSkip = 0
        if (values.length > 0) {
          const lastValue = values[values.length - 1]!
          const alreadySkipped = high - lastValue
          const position = lastValue - low
          if (position + step > high - low + 1 && alreadySkipped < step)
            toSkip = step - alreadySkipped
        }
        values = values.concat(pythonRange(low + toSkip, to + 1, step))
      } else if (from === to) {
        // croniter reads "a-a" as the whole cycle, like jan-jan.
        values = pythonRange(low, high + 1, step)
      } else {
        values = pythonRange(from, to + 1, step)
      }

      const items: (string | number)[] =
        index === WEEKDAY && nth !== null && nth !== 'l'
          ? values.map((value) => `${value}#${nth}`)
          : values
      const newItems = items.filter((item) => !list.includes(item))
      list.push(...newItems)
    } else {
      if (text.startsWith('-')) throw new CronError('negative number')
      let value: number | string = text
      if (!STAR_OR_INT_RE.test(text)) value = nameToValue(index, text)
      if (typeof value === 'string' && ONLY_INT_RE.test(value)) value = Number(value)
      const aliased = valueAlias(value as FieldValue, index)
      if (aliased !== '*' && aliased !== 'l' && (aliased < low || aliased > high))
        throw new CronError('out of range')
      result.push(aliased)

      if (index === WEEKDAY && nth !== null) {
        const weekday = aliased as number
        const set = spec.nthWeekdays.get(weekday) ?? new Set<Nth>()
        set.add(nth)
        spec.nthWeekdays.set(weekday, set)
      }
    }
  }

  let values = [...new Set(result)].sort((a, b) => {
    const keyA = sortKey(a)
    const keyB = sortKey(b)
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })
  if (values.length === LEN_MEANS_ALL[index]) {
    // croniter keeps a full day list when the other day field has no "*".
    const keepList =
      (index === DAY && !expressions[WEEKDAY]!.includes('*')) ||
      (index === WEEKDAY && !expressions[DAY]!.includes('*'))
    if (!keepList) values = ['*']
  }
  spec.fields.push(values.length === 1 && values[0] === '*' ? ['*'] : values)
}

const parseCron = (cronExpression: string): CronSpec => {
  const lower = cronExpression.toLowerCase()
  const expressions = (ALIASES.get(lower) ?? lower).split(/\s+/).filter(Boolean)
  if (expressions.length !== 5) throw new CronError('need 5 fields')

  const spec: CronSpec = { fields: [], nthWeekdays: new Map(), nearestWeekdays: [] }
  expressions.forEach((expr, index) => expandField(index, expr, expressions, spec))

  if (spec.nthWeekdays.size > 0) {
    const weekdays = new Set(spec.fields[WEEKDAY])
    const literals = [...weekdays].filter(
      (value) => value !== '*' && !spec.nthWeekdays.has(value as number),
    )
    if (literals.length > 0 && weekdays.size !== LEN_MEANS_ALL[WEEKDAY])
      throw new CronError('nth mixed with plain weekdays')
  }
  return spec
}

const startOfDay = (wallMs: number) => Math.floor(wallMs / DAY_MS) * DAY_MS

const nextNearestDiff = (current: number, values: FieldValue[], rangeValue: number): number => {
  for (const item of values) {
    let value = item
    if (value === 'l') value = rangeValue
    else if (value === '*' || value > rangeValue) continue
    if (value >= current) return value - current
  }
  const first = values[0]
  if (typeof first !== 'number') throw new CronError('no value')
  return first - current + rangeValue
}

// Days in the month that fall on the weekday (0 = Sunday), in order.
const weekdayDays = (year: number, month: number, weekday: number): number[] => {
  const firstWeekday = dayOfWeek(year, month, 1)
  const days: number[] = []
  for (let day = 1 + ((weekday - firstWeekday + 7) % 7); day <= daysInMonth(year, month); day += 7)
    days.push(day)
  return days
}

// Nearest Monday to Friday day for "15W", as croniter computes it.
const nearestWeekday = (year: number, month: number, wantedDay: number): number => {
  const lastDay = daysInMonth(year, month)
  const day = Math.min(wantedDay, lastDay)
  const weekday = dayOfWeek(year, month, day)
  if (weekday >= 1 && weekday <= 5) return day
  if (weekday === 6) return day > 1 ? day - 1 : day + 2
  return day < lastDay ? day + 1 : day - 2
}

// croniter._calc without a timezone. Earliest matching wall time after start, in whole minutes.
const nextMatchingWallMs = (startWallMs: number, spec: CronSpec, fields: FieldValue[][]) => {
  let time = Math.floor((startWallMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS
  let date = new Date(time)
  let year = date.getUTCFullYear()
  let month = date.getUTCMonth() + 1
  const currentYear = year

  const moveDays = (days: number) => startOfDay(time) + days * DAY_MS

  const procMonth = (): number | null => {
    if (fields[MONTH]!.includes('*')) return null
    const diff = nextNearestDiff(date.getUTCMonth() + 1, fields[MONTH]!, 12)
    if (diff === 0) return null
    const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + diff
    return Date.UTC(Math.floor(total / 12), total - Math.floor(total / 12) * 12, 1)
  }

  const procDayOfMonth = (): number | null => {
    if (fields[DAY]!.includes('*')) return null
    const days = daysInMonth(year, month)
    if (fields[DAY]!.includes('l') && days === date.getUTCDate()) return null
    const diff = nextNearestDiff(date.getUTCDate(), fields[DAY]!, days)
    return diff === 0 ? null : moveDays(diff)
  }

  const pickDay = (candidates: number[]): number | null => {
    const day = date.getUTCDate()
    const later = candidates.filter((candidate) => day <= candidate)
    if (later.length === 0) return moveDays(daysInMonth(year, month) - day + 1)
    const diff = Math.min(...later) - day
    return diff === 0 ? null : moveDays(diff)
  }

  const procNearestWeekday = (): number | null =>
    pickDay(
      spec.nearestWeekdays.map((day) =>
        nearestWeekday(date.getUTCFullYear(), date.getUTCMonth() + 1, day),
      ),
    )

  const procDayOfWeek = (): number | null => {
    if (fields[WEEKDAY]!.includes('*')) return null
    const diff = nextNearestDiff(date.getUTCDay(), fields[WEEKDAY]!, 7)
    return diff === 0 ? null : moveDays(diff)
  }

  const procNthWeekday = (): number | null => {
    const candidates: number[] = []
    for (const [weekday, nths] of spec.nthWeekdays) {
      const days = weekdayDays(date.getUTCFullYear(), date.getUTCMonth() + 1, weekday)
      for (const nth of nths) {
        if (nth === 'l') candidates.push(days[days.length - 1]!)
        else if (days.length >= nth) candidates.push(days[nth - 1]!)
      }
    }
    return pickDay(candidates)
  }

  const procHour = (): number | null => {
    if (fields[HOUR]!.includes('*')) return null
    const diff = nextNearestDiff(date.getUTCHours(), fields[HOUR]!, 24)
    if (diff === 0) return null
    return Math.floor(time / HOUR_MS) * HOUR_MS + diff * HOUR_MS
  }

  const procMinute = (): number | null => {
    if (fields[MINUTE]!.includes('*')) return null
    const diff = nextNearestDiff(date.getUTCMinutes(), fields[MINUTE]!, 60)
    if (diff === 0) return null
    return time + diff * MINUTE_MS
  }

  const procs = [
    procMonth,
    spec.nearestWeekdays.length > 0 ? procNearestWeekday : procDayOfMonth,
    spec.nthWeekdays.size > 0 ? procNthWeekday : procDayOfWeek,
    procHour,
    procMinute,
  ]

  while (Math.abs(year - currentYear) <= MAX_YEARS_BETWEEN_MATCHES) {
    let changed = false
    for (const proc of procs) {
      const next = proc()
      if (next === null) continue
      time = next
      date = new Date(time)
      year = date.getUTCFullYear()
      month = date.getUTCMonth() + 1
      changed = true
      break
    }
    if (!changed) return time
  }
  throw new CronError('no match within the year limit')
}

// Attach the timezone the way croniter does with zoneinfo.
// A time in a DST gap moves to the first existing minute. In a fold, the earlier
// occurrence wins unless the earlier one is not after now.
const attachTimezone = (wallMs: number, timezone: string, now: number) => {
  let wall: WallTime = wallFromUtcMs(wallMs)
  let instants = toInstants(wall, timezone)
  if (instants.length === 0) {
    while (instants.length === 0) {
      wall = wallFromUtcMs(wallToUtcMs(wall) + MINUTE_MS)
      instants = toInstants(wall, timezone)
    }
    return { instant: instants[0]!, exists: false }
  }
  if (instants.length > 1 && instants[0]! <= now) return { instant: instants[1]!, exists: true }
  return { instant: instants[0]!, exists: true }
}

// croniter._calc with a timezone-aware start.
const nextRunForFields = (
  spec: CronSpec,
  fields: FieldValue[][],
  timezone: string,
  now: number,
): number => {
  const nowWallMs = toWallMs(now, timezone)
  let wallMs = nextMatchingWallMs(nowWallMs, spec, fields)
  let { instant, exists } = attachTimezone(wallMs, timezone, now)

  if (!exists && (instant <= now || fields[HOUR]!.includes('*'))) {
    // The wall time does not exist and moving forward is not right. Find the next one that exists.
    while (!exists) {
      wallMs = nextMatchingWallMs(wallMs, spec, fields)
      ;({ instant, exists } = attachTimezone(wallMs, timezone, now))
    }
  }

  const offsetDelta = offsetMinutesAt(instant, timezone) - offsetMinutesAt(now, timezone)
  if (offsetDelta === 0) return instant

  // A DST change sits between now and the run. Check the match for the other offset too.
  const alternativeWallMs = nextMatchingWallMs(nowWallMs + offsetDelta * MINUTE_MS, spec, fields)
  const alternative = attachTimezone(alternativeWallMs, timezone, now).instant
  if (alternative <= now) return instant
  return instant > alternative ? alternative : instant
}

// Next run strictly after now. Throws when the backend would raise.
const nextRun = (spec: CronSpec, timezone: string, now: number): number => {
  const { fields } = spec
  if (fields[DAY]![0] !== '*' && fields[WEEKDAY]![0] !== '*') {
    // Day of month and day of week both set: a day matches either one.
    const byDayOfMonth = nextRunForFields(
      spec,
      fields.map((field, index) => (index === WEEKDAY ? ['*'] : field)),
      timezone,
      now,
    )
    const byDayOfWeek = nextRunForFields(
      spec,
      fields.map((field, index) => (index === DAY ? ['*'] : field)),
      timezone,
      now,
    )
    return byDayOfMonth < byDayOfWeek ? byDayOfMonth : byDayOfWeek
  }
  return nextRunForFields(spec, fields, timezone, now)
}

/**
 * Validate a cron expression format and syntax
 *
 * @param cronExpression - Standard 5-field cron expression to validate
 * @returns boolean indicating if the cron expression is valid
 */
export const isValidCronExpression = (cronExpression: string): boolean => {
  if (!cronExpression || cronExpression.trim() === '') return false

  const parts = cronExpression.trim().split(/\s+/)

  // Support both 5-field format and predefined expressions
  if (parts.length !== 5 && !cronExpression.startsWith('@')) return false

  try {
    // Use cron-parser to validate the expression
    CronExpressionParser.parse(cronExpression)
    return true
  } catch {
    return false
  }
}

/**
 * Next run instants of a cron expression, each one computed from the run before it,
 * the same way the backend scheduler moves from run to run.
 *
 * @returns epoch milliseconds, earliest first. Empty when the expression is invalid.
 * Shorter than count when the backend would fail to find the next run.
 */
export const getNextRunInstants = (
  cronExpression: string,
  timezone: string,
  count: number,
  from: number = Date.now(),
): number[] => {
  if (!isValidCronExpression(cronExpression)) return []
  const runs: number[] = []
  try {
    const spec = parseCron(cronExpression)
    let now = from
    while (runs.length < count) {
      now = nextRun(spec, timezone, now)
      runs.push(now)
    }
  } catch {
    // Same as the backend: no run can be computed from here on.
  }
  return runs
}
