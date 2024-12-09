import dayjs, { type ConfigType } from 'dayjs'

export const isAfter = (date: ConfigType, compare: ConfigType) => {
  return dayjs(date).isAfter(dayjs(compare))
}
