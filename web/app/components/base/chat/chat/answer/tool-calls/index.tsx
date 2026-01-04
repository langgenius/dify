import type { ToolCallItem } from '../../type'
import ToolCallsItem from './item'

type ToolCallsProps = {
  toolCalls: ToolCallItem[]
}
const ToolCalls = ({
  toolCalls,
}: ToolCallsProps) => {
  return (
    <div>
      {toolCalls.map((toolCall: ToolCallItem) => (
        <ToolCallsItem key={toolCall.tool_call_id} payload={toolCall} />
      ))}
    </div>
  )
}

export default ToolCalls
