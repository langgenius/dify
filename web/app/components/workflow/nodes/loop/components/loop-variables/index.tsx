import type {
  LoopVariable,
  LoopVariablesComponentShape,
} from '@/app/components/workflow/nodes/loop/types'
import Empty from './empty'
import Item from './item'

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
