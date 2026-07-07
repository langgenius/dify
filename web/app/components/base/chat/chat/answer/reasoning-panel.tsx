import type { FC } from 'react'
import { Markdown } from '@/app/components/base/markdown'
import ThinkingDetails from '@/app/components/base/markdown-blocks/thinking-details'
import { useElapsedTimer } from '@/app/components/base/markdown-blocks/use-elapsed-timer'

type ReasoningPanelProps = {
  // reasoning (chain-of-thought) deltas accumulated per LLM node id
  content: Record<string, string>
  // true once reasoning is over (answer started / terminal marker / response ended);
  // latches the elapsed timer and collapses the panel. Computed by the caller.
  done: boolean
}

const ReasoningPanel: FC<ReasoningPanelProps> = ({ content, done }) => {
  // First version renders one panel for the run; multiple LLM nodes are concatenated.
  // Computed inline (not memoized): the live stream mutates `content` in place under a
  // stable reference, so a [content]-keyed memo would never see new deltas.
  const text = Object.values(content).filter(Boolean).join('\n\n')
  const { elapsedTime, isComplete } = useElapsedTimer(done)

  if (!text)
    return null

  return (
    <ThinkingDetails className="my-2" isComplete={isComplete} elapsedTime={elapsedTime}>
      <Markdown content={text} />
    </ThinkingDetails>
  )
}

export default ReasoningPanel
