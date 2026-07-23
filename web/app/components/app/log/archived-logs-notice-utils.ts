const LAST_THREE_MONTHS_PERIOD = '4'

type TimePeriodMapping = Record<string, { value: number }>

export function shouldShowArchivedLogsNotice(period: string, periodMapping: TimePeriodMapping) {
  const periodValue = periodMapping[period]?.value
  const lastThreeMonthsValue = periodMapping[LAST_THREE_MONTHS_PERIOD]?.value
  if (periodValue === undefined || lastThreeMonthsValue === undefined) return false

  return periodValue < 0 || periodValue > lastThreeMonthsValue
}
