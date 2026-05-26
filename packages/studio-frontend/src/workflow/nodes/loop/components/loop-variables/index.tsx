import type {
  LoopVariable,
  LoopVariablesComponentShape,
} from '@/app/components/workflow/nodes/loop/types'
import Empty from '@/app/components/workflow/nodes/loop/components/loop-variables/empty'
import Item from '@/app/components/workflow/nodes/loop/components/loop-variables/item'

type LoopVariableProps = {
  variables?: LoopVariable[]
} & LoopVariablesComponentShape

const LoopVariableComponent = ({
  variables = [],
  ...restProps
}: LoopVariableProps) => {
  if (!variables.length)
    return <Empty />

  return variables.map(variable => (
    <Item
      key={variable.id}
      item={variable}
      {...restProps}
    />
  ))
}

export default LoopVariableComponent
