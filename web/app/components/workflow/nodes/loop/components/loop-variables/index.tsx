import Empty from './empty'
import Item from './item'

type LoopVariableProps = {
  nodeId: string
  variables: any[]
}
const LoopVariable = ({
  nodeId,
  variables,
}: LoopVariableProps) => {
  if (!variables.length)
    return <Empty />

  return variables.map((variable, index) => (
    <Item
      key={index}
      nodeId={nodeId}
      item={variable}
    />
  ))
}

export default LoopVariable
