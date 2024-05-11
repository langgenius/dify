import type { CommonNodeType } from '@/app/components/workflow/types'

export type IterationNodeType = CommonNodeType & {
  start_node_id: string
}
