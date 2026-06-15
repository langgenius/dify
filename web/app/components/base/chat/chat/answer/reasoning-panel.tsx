import type { FC } from 'react'
import { useMemo } from 'react'
import { Markdown } from '@/app/components/base/markdown'
import ThinkingDetails from '@/app/components/base/markdown-blocks/thinking-details'
import { useElapsedTimer } from '@/app/components/base/markdown-blocks/use-elapsed-timer'

type ReasoningPanelProps = {
  // reasoning (chain-of-thought) deltas accumulated per LLM node id
  content: Record<string, string>
  isFinished?: boolean
  responding?: boolean
}

const ReasoningPanel: FC<ReasoningPanelProps> = ({ content, isFinished, responding }) => {
  // First version renders one panel for the run; multiple LLM nodes are concatenated.
  const text = useMemo(() => Object.values(content).filter(Boolean).join('\n\n'), [content])
  // Done when the terminal marker arrived, or the response is no longer active.
  const { elapsedTime, isComplete } = useElapsedTimer(!!isFinished || responding === false)

  if (!text)
    return null

  return (
    <ThinkingDetails isComplete={isComplete} elapsedTime={elapsedTime}>
      <Markdown content={text} />
    </ThinkingDetails>
  )
}

export default ReasoningPanel
