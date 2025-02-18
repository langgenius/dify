import type { Dayjs } from 'dayjs'

export enum ViewType {
  date = 'date',
  yearMonth = 'yearMonth',
  time = 'time',
}

export enum Period {
  AM = 'AM',
  PM = 'PM',
}

export type DatePickerProps = {
  value: Dayjs | undefined
  placeholder?: string
  onChange: (date?: Dayjs) => void
  onClear: () => void
  needTimePicker?: boolean
}

export type DatePickerHeaderProps = {
  handleOpenYearMonthPicker: () => void
  currentDate: Dayjs
  onClickNextMonth: () => void
  onClickPrevMonth: () => void
}

export type DatePickerFooterProps = {
  needTimePicker: boolean
  displayTime: string
  handleClickTimePicker: () => void
  handleSelectCurrentDate: () => void
  handleConfirmDate: () => void
}

export type TimePickerProps = {
  value: Dayjs | undefined
  onChange: (date: Dayjs) => void
}

export type TimePickerFooterProps = {
  handleSelectCurrentTime: () => void
  handleConfirm: () => void
}

export type Day = {
  date: Dayjs
  isCurrentMonth: boolean
}

export type CalendarProps = {
  days: Day[]
  selectedDate: Dayjs | undefined
  onDateClick: (date: Dayjs) => void
  wrapperClassName?: string
}

export type CalendarItemProps = {
  day: Day
  selectedDate: Dayjs | undefined
  onClick: (date: Dayjs) => void
}

export type TimeOptionsProps = {
  selectedTime: Dayjs
  handleSelectHour: (hour: string) => void
  handleSelectMinute: (minute: string) => void
  handleSelectPeriod: (period: Period) => void
}

export type YearAndMonthPickerHeaderProps = {
  selectedYear: number
  selectedMonth: number
  onClick: () => void
}

export type YearAndMonthPickerOptionsProps = {
  selectedYear: number
  selectedMonth: number
  handleYearSelect: (year: number) => void
  handleMonthSelect: (month: number) => void
}

export type YearAndMonthPickerFooterProps = {
  handleYearMonthCancel: () => void
  handleYearMonthConfirm: () => void
}
