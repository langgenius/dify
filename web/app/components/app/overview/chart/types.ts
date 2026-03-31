import type { Dayjs } from 'dayjs'

export type PeriodParams = {
  name: string
  query?: {
    start: string
    end: string
  }
}

export type TimeRange = {
  start: Dayjs
  end: Dayjs
}

export type PeriodParamsWithTimeRange = {
  name: string
  query?: TimeRange
}

export type IBizChartProps = {
  period: PeriodParams
  id: string
}
