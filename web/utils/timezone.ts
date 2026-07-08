import tz from './timezone.json'

type Item = {
  value: string
  name: string
}
export const timezones: Item[] = tz

export const getBrowserTimezone = () => {
  if (typeof Intl === 'undefined')
    return undefined

  return new Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
}
