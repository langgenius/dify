import type {
  LoopVariable,
  LoopVariablesComponentShape,
} from '../../../../nodes/loop/types'
import Empty from '../../../../nodes/loop/components/loop-variables/empty'
import Item from '../../../../nodes/loop/components/loop-variables/item'

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
