import type { LLMGenerationItem } from '@/types/workflow'
import ToolCallItemComponent from '@/app/components/workflow/run/llm-log/tool-call-item'

type GenerationContentProps = {
  llmGenerationItems: LLMGenerationItem[]
}
const GenerationContent = ({
  llmGenerationItems,
}: GenerationContentProps) => {
  return (
    <div className="my-1 space-y-1">
      {llmGenerationItems.map((llmGenerationItem: LLMGenerationItem, index: number) => (
        <ToolCallItemComponent
          key={index}
          payload={llmGenerationItem}
          className="bg-background-gradient-bg-fill-chat-bubble-bg-2 shadow-none"
        />
      ))}
    </div>
  )
}

export default GenerationContent
