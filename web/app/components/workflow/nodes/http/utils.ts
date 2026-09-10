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
