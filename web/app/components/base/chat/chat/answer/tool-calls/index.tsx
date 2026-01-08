import type { ToolCallItem } from '@/types/workflow'
import ToolCallItemComponent from '@/app/components/workflow/run/llm-log/tool-call-item'

type ToolCallsProps = {
  toolCalls: ToolCallItem[]
}
const ToolCalls = ({
  toolCalls,
}: ToolCallsProps) => {
  return (
    <div className="my-1 space-y-1">
      {toolCalls.map((toolCall: ToolCallItem, index: number) => (
        <ToolCallItemComponent
          key={index}
          payload={toolCall}
          className="bg-background-gradient-bg-fill-chat-bubble-bg-2 shadow-none"
        />
      ))}
    </div>
  )
}

export default ToolCalls
