import tz from './timezone.json'

type Item = {
  value: number | string
  name: string
}
export const timezones: Item[] = tz

export const getBrowserTimezone = () => {
  if (typeof Intl === 'undefined')
    return undefined

  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
}
