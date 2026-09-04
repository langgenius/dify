import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { difyBuilderLiveProgressAtom, difyBuilderStreamingTurnAtom } from '../session/state'
import { AssistantReply } from './conversation-card'
import { Thinking } from './thinking'

export const StreamingAssistantTurn = ({
  busy,
  hasThinkingTurn,
  onContentChange,
}: {
  busy: boolean
  hasThinkingTurn: boolean
  onContentChange?: () => void
}) => {
  const liveProgress = useAtomValue(difyBuilderLiveProgressAtom)
  const streamingTurn = useAtomValue(difyBuilderStreamingTurnAtom)
  const trace = liveProgress?.trace
  const hasProgress = (trace?.steps?.length ?? 0) > 0

  useEffect(() => {
    if (hasProgress || streamingTurn?.replyText) onContentChange?.()
  }, [hasProgress, liveProgress?.trace, onContentChange, streamingTurn?.replyText])

  if (!hasProgress && !streamingTurn?.replyText)
    return busy && !hasThinkingTurn ? <Thinking /> : null

  return (
    <div className="flex flex-col gap-2">
      {hasProgress ? <Thinking trace={trace} /> : null}
      {streamingTurn?.replyText ? <AssistantReply text={streamingTurn.replyText} /> : null}
    </div>
  )
}
