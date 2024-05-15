import type {
  BlockEnum,
  CommonNodeType,
  ValueSelector,
} from '@/app/components/workflow/types'

export type IterationNodeType = CommonNodeType & {
  startNodeType?: BlockEnum
  start_node_id: string // start node id in the iteration
  iterator_selector: ValueSelector
  output_selector: ValueSelector
}
