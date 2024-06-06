import type {
  BlockEnum,
  CommonNodeType,
  ValueSelector,
  VarType,
} from '@/app/components/workflow/types'

export type IterationNodeType = CommonNodeType & {
  startNodeType?: BlockEnum
  start_node_id: string // start node id in the iteration
  iteration_id?: string
  iterator_selector: ValueSelector
  output_selector: ValueSelector
  output_type: VarType // output type.
}
