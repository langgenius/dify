import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  difyBuilderExecutionProgressAtom,
  difyBuilderReasoningAtom,
  difyBuilderStreamingTurnAtom,
} from '../session/state'
import { AssistantReply } from './conversation-card'
import { ExecutionProgress } from './execution-progress'
import { Thinking } from './thinking'

export const StreamingAssistantTurn = ({
  busy,
  onContentChange,
}: {
  busy: boolean
  onContentChange?: () => void
}) => {
  const { t } = useTranslation()
  const liveExecution = useAtomValue(difyBuilderExecutionProgressAtom)
  const reasoning = useAtomValue(difyBuilderReasoningAtom)
  const streamingTurn = useAtomValue(difyBuilderStreamingTurnAtom)
  const activityCount = liveExecution?.execution.activities?.length ?? 0
  const reasoningText = reasoning?.text ?? ''
  const replyText = streamingTurn?.replyText ?? ''

  useEffect(() => {
    if (activityCount > 0 || reasoningText || replyText) onContentChange?.()
  }, [activityCount, onContentChange, reasoningText, replyText])

  if (activityCount === 0 && !reasoningText && !replyText) {
    if (!busy) return null
    return (
      <div role="status" aria-live="polite" className="flex h-8 items-center gap-2 px-1">
        <span
          aria-hidden
          className="i-ri-loader-4-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
        />
        <span className="text-[13px] font-medium text-text-tertiary">
          {t(($) => $['common.running'], { ns: 'workflow' })}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {activityCount > 0 ? <ExecutionProgress execution={liveExecution?.execution} /> : null}
      <Thinking text={reasoningText} isStreaming />
      {replyText ? <AssistantReply text={replyText} /> : null}
    </div>
  )
}
