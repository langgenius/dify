import type { Style } from './color'

type JsonPrimitive = string | number | boolean | null

export type Printable = JsonPrimitive | readonly unknown[] | Record<string, unknown>

export type View<T extends Printable = Printable> = Readonly<{
  json: T
  text: (style: Style) => string
}>

const TEXT_KEY = 'text'
const JSON_KEY = 'json'

export function view<T extends Printable>(json: T, text: View<T>['text']): View<T> {
  return Object.freeze({ json, text })
}

export function isView(value: unknown): value is View {
  return (
    typeof value === 'object' &&
    value !== null &&
    JSON_KEY in value &&
    TEXT_KEY in value &&
    typeof (value as View).text === 'function'
  )
}
