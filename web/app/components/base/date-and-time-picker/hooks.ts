import { useTranslation } from 'react-i18next'
import { Period } from './types'
import dayjs from './utils/dayjs'

const YEAR_RANGE = 100

const daysInWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const useDaysOfWeek = () => {
  const { t } = useTranslation()
  return daysInWeek.map(day => t(`daysInWeek.${day}`, { ns: 'time' }))
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const useMonths = () => {
  const { t } = useTranslation()
  return monthNames.map(month => t(`months.${month}`, { ns: 'time' }))
}

export const useYearOptions = () => {
  const yearOptions = Array.from({ length: 200 }, (_, i) => dayjs().year() - YEAR_RANGE / 2 + i)
  return yearOptions
}

export const useTimeOptions = () => {
  const hourOptions = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'))
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'))
  const periodOptions = [Period.AM, Period.PM]

  return {
    hourOptions,
    minuteOptions,
    periodOptions,
  }
}
