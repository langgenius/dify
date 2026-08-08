import type { BodyPayload } from './types'
import { BodyPayloadValueType } from './types'

export const transformToBodyPayload = (old: string, hasKey: boolean): BodyPayload => {
  if (!hasKey) {
    return [
      {
        type: BodyPayloadValueType.text,
        value: old,
      },
    ]
  }
  const bodyPayload = old.split('\n').map((item) => {
    const [key, ...others] = item.split(':')
    return {
      key: key || '',
      type: BodyPayloadValueType.text,
      value: others.join(':'),
    }
  })
  return bodyPayload
}

/**
 * HTTP header/param key-value rows are stored as a single newline-delimited
 * string (see hooks/use-key-value-list.ts), one row per line. If a literal
 * newline ends up inside a key or value - e.g. the user presses Enter in the
 * rich-text input, or pastes multi-line text - it gets mistaken for a row
 * separator on the next parse and splits/corrupts that row. Newlines aren't
 * valid in HTTP header/param values anyway, so collapse them to a single
 * space instead of letting them through.
 */
export const sanitizeKeyValueField = (value: string): string => value.replace(/[\r\n]+/g, ' ')
