import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { difyBuilderStreamingTurnAtom } from '../session/state'
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
  const streamingTurn = useAtomValue(difyBuilderStreamingTurnAtom)

  useEffect(() => {
    if (streamingTurn?.replyText) onContentChange?.()
  }, [onContentChange, streamingTurn?.replyText])

  if (streamingTurn?.replyText) return <AssistantReply text={streamingTurn.replyText} />
  if (busy && !hasThinkingTurn) return <Thinking />
  return null
}
