import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'
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
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const liveExecution = useAtomValue(difyBuilderExecutionProgressAtom)
  const reasoning = useAtomValue(difyBuilderReasoningAtom)
  const streamingTurn = useAtomValue(difyBuilderStreamingTurnAtom)
  const activityCount = liveExecution?.execution.activities?.length ?? 0
  const reasoningText = reasoning?.text ?? ''
  const hasReasoning = Boolean(reasoningText.trim())
  const replyText = streamingTurn?.replyText ?? ''

  useEffect(() => {
    if (activityCount > 0 || hasReasoning || replyText) onContentChange?.()
  }, [activityCount, hasReasoning, onContentChange, replyText])

  if (activityCount === 0 && !hasReasoning && !replyText) {
    if (!busy) return null
    return (
      <article>
        <h3 className="sr-only">{t(($) => $.panelTitle, { ns: 'difyBuilder' })}</h3>
        <div role="status" aria-live="polite" className="flex h-8 items-center gap-2 px-1">
          <span
            aria-hidden
            className="i-ri-loader-4-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
          />
          <span className="text-[13px] font-medium text-text-tertiary">
            {t(($) => $.running, { ns: 'difyBuilder' })}
          </span>
        </div>
      </article>
    )
  }

  return (
    <article className="flex flex-col gap-2">
      <h3 className="sr-only">{t(($) => $.panelTitle, { ns: 'difyBuilder' })}</h3>
      {activityCount === 0 && busy && (
        <span role="status" aria-live="polite" className="sr-only">
          {t(($) => $.running, { ns: 'difyBuilder' })}
        </span>
      )}
      {activityCount > 0 ? (
        <ExecutionProgress
          replyLanguage={liveExecution?.replyLanguage}
          execution={liveExecution?.execution}
        />
      ) : null}
      <Thinking text={reasoningText} isStreaming onVisibleContentChange={onContentChange} />
      {replyText ? <AssistantReply text={replyText} /> : null}
    </article>
  )
}
