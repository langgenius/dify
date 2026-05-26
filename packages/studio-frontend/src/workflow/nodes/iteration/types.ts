import type {
  BlockEnum,
  CommonNodeType,
  ErrorHandleMode,
  ValueSelector,
  VarType,
} from '@/app/components/workflow/types'

export type IterationNodeType = CommonNodeType & {
  startNodeType?: BlockEnum
  start_node_id: string // start node id in the iteration
  iteration_id?: string
  iterator_selector: ValueSelector
  iterator_input_type: VarType
  output_selector: ValueSelector
  output_type: VarType // output type.
  is_parallel: boolean // open the parallel mode or not
  parallel_nums: number // the numbers of parallel
  error_handle_mode: ErrorHandleMode // how to handle error in the iteration
  flatten_output: boolean // whether to flatten the output array if all elements are lists
  _isShowTips: boolean // when answer node in parallel mode iteration show tips
}
