import type {
  BlockEnum,
  CommonNodeType,
} from '@/app/components/workflow/types'

export type IterationNodeType = CommonNodeType & {
  startNodeType?: BlockEnum
  start_node_id: string
}
