import tz from './timezone.json'

type Item = {
  value: number | string
  name: string
}
export const timezones: Item[] = tz
