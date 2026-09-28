import type { Locale } from '@daypicker/react'
import { enUS } from '@daypicker/react/locale/en-US'

// DayPicker has no Lao locale. Keep the application fallback here.
const laoCalendarLocale: Locale = {
  ...enUS,
  code: 'lo-LA',
  labels: {
    labelDayButton: (date) =>
      new Intl.DateTimeFormat('lo-LA', { dateStyle: 'full', timeZone: 'UTC' }).format(date),
    labelGrid: (date) =>
      new Intl.DateTimeFormat('lo-LA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        date,
      ),
    labelWeekday: (date) =>
      new Intl.DateTimeFormat('lo-LA', { weekday: 'long', timeZone: 'UTC' }).format(date),
  },
  localize: {
    ...enUS.localize,
    month: (month) =>
      new Intl.DateTimeFormat('lo-LA', { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2025, month, 1)),
      ),
    day: (day) =>
      new Intl.DateTimeFormat('lo-LA', { weekday: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2025, 0, 5 + day)),
      ),
  },
}

export { laoCalendarLocale }
