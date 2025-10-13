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

export type TriggerProps = {
  value: Dayjs | undefined
  selectedDate: Dayjs | undefined
  isOpen: boolean
  handleClear: (e: React.MouseEvent) => void
  handleClickTrigger: (e: React.MouseEvent) => void
}

export type DatePickerProps = {
  value: Dayjs | undefined
  timezone?: string
  placeholder?: string
  needTimePicker?: boolean
  onChange: (date: Dayjs | undefined) => void
  onClear: () => void
  triggerWrapClassName?: string
  renderTrigger?: (props: TriggerProps) => React.ReactNode
  minuteFilter?: (minutes: string[]) => string[]
  popupZIndexClassname?: string
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
  view: ViewType
  handleClickTimePicker: () => void
  handleSelectCurrentDate: () => void
  handleConfirmDate: () => void
}

export type TriggerParams = {
  isOpen: boolean
  inputElem: React.ReactNode
  onClick: (e: React.MouseEvent) => void
}
export type TimePickerProps = {
  value: Dayjs | string | undefined
  timezone?: string
  placeholder?: string
  onChange: (date: Dayjs | undefined) => void
  onClear: () => void
  renderTrigger?: (props: TriggerParams) => React.ReactNode
  title?: string
  minuteFilter?: (minutes: string[]) => string[]
  popupClassName?: string
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
  selectedTime: Dayjs | undefined
  minuteFilter?: (minutes: string[]) => string[]
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
