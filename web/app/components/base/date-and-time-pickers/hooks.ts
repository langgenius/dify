import dayjs from 'dayjs'
import { Period } from './types'
import { useRef } from 'react'

const YEAR_RANGE = 100

export const useDaysOfWeek = () => {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}

export const useMonths = () => {
  return [
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
  ]
}

export const useYearOptions = () => {
  const yearOptions = useRef(Array.from({ length: 200 }, (_, i) => dayjs().year() - YEAR_RANGE / 2 + i))
  return yearOptions.current
}

export const useTimeOptions = () => {
  const hourOptions = useRef(Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')))
  const minuteOptions = useRef(Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')))
  const periodOptions = useRef([Period.AM, Period.PM])

  return {
    hourOptions: hourOptions.current,
    minuteOptions: minuteOptions.current,
    periodOptions: periodOptions.current,
  }
}
