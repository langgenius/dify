import type { CommonNodeType } from '@/app/components/workflow/types'

export type SleepNodeType = CommonNodeType & {
  sleep_time_ms: number
}
