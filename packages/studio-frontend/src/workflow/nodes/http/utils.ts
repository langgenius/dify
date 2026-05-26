import type { BodyPayload } from '@/app/components/workflow/nodes/http/types'
import { BodyPayloadValueType } from '@/app/components/workflow/nodes/http/types'

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
    const [key, value] = item.split(':')
    return {
      key: key || '',
      type: BodyPayloadValueType.text,
      value: value || '',
    }
  })
  return bodyPayload
}
