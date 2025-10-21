import dayjs from './utils/dayjs'
import { Period } from './types'
import { useTranslation } from 'react-i18next'

const YEAR_RANGE = 100

export const useDaysOfWeek = () => {
  const { t } = useTranslation()
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => t(`time.daysInWeek.${day}`))

  return daysOfWeek
}

export const useMonths = () => {
  const { t } = useTranslation()
  const months = [
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
  ].map(month => t(`time.months.${month}`))

  return months
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
