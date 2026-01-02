import type { CommonNodeType } from '@/app/components/workflow/types'

export type HumanInputNodeType = CommonNodeType & {
  pause_reason: string
}
