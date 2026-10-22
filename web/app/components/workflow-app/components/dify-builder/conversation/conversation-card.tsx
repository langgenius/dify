import type { ConversationItem, FormField } from '../types'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { DifyBuilderCard } from '../cards/card-shell'
import { useBuilderText } from '../copy/use-builder-text'
import { ExecutionProgress } from './execution-progress'
import { PlanCard } from './plan-card'
import { PreflightContextCard } from './preflight-context-card'
import { ReadOnlyFormResponse } from './read-only-form-response'
import arrivalStyles from './reply-arrival.module.css'
import { TestResultCard } from './test-result-card'
import { Thinking } from './thinking'

export const AssistantReply = ({
  text,
  isStreaming = false,
}: {
  text: string
  isStreaming?: boolean
}) => (
  <Markdown
    content={text}
    mode={isStreaming ? 'streaming' : 'static'}
    isAnimating={isStreaming}
    className="px-1 text-sm! leading-5! tracking-[-0.07px]"
  />
)

export const UserMessage = memo(({ text }: { text: string }) => {
  const { t } = useTranslation(['common', 'difyBuilder'])

  return (
    <article className="flex justify-end">
      <h3 className="sr-only">{t(($) => $.you, { ns: 'common' })}</h3>
      <div className="max-w-79 rounded-2xl bg-background-default-dimmed px-4 py-3 text-[13px] leading-4 whitespace-pre-wrap text-text-primary">
        {text}
      </div>
    </article>
  )
})

export const ConversationCard = memo(
  ({
    item,
    invalidated,
    sourceFormFields,
  }: {
    item: ConversationItem
    invalidated: boolean
    sourceFormFields?: FormField[]
  }) => {
    const [animateArrival] = useState(
      () =>
        item.kind === 'assistant_turn' &&
        Boolean(item.receivedAt && Date.now() - item.receivedAt < 160),
    )
    const replyLanguage = 'reply_language' in item.payload ? item.payload.reply_language : undefined
    const { locale, renderText } = useBuilderText(replyLanguage)
    const { t } = useTranslation(['difyBuilder'], { lng: locale })

    if (item.kind === 'user' || item.kind === 'decision')
      return <UserMessage text={renderText(item.payload.text)} />

    if (item.kind === 'assistant_turn') {
      const hasExecution = (item.payload.execution.activities?.length ?? 0) > 0
      const hasReasoning = Boolean(item.payload.reasoning_text?.trim())
      const hasReply = Boolean(item.payload.reply_text)
      if (!hasExecution && !hasReasoning && !hasReply) return null
      return (
        <article
          lang={locale}
          className={`flex flex-col gap-2 ${animateArrival ? arrivalStyles.enter : ''}`}
        >
          <h3 className="sr-only">{t(($) => $.panelTitle, { ns: 'difyBuilder' })}</h3>
          {hasExecution ? (
            <ExecutionProgress replyLanguage={replyLanguage} execution={item.payload.execution} />
          ) : null}
          <Thinking text={item.payload.reasoning_text} />
          {item.payload.reply_text ? (
            <AssistantReply text={renderText(item.payload.reply_text)} />
          ) : null}
        </article>
      )
    }

    // Retain legacy rows in history for sequence reconciliation without displaying them.
    if (item.kind === 'notice') return null

    if (item.kind === 'interaction_response') {
      const fields = item.payload.fields ?? []
      const hasFields = fields.length > 0
      return (
        <article className="w-full rounded-xl border border-components-panel-border px-1 py-[3px]">
          <div className={hasFields ? 'px-2 pt-1.5 pb-0.5' : 'rounded-lg px-2 py-1.5'}>
            <h3
              className={
                hasFields
                  ? 'system-sm-medium wrap-break-word text-text-secondary'
                  : 'system-sm-regular wrap-break-word text-text-tertiary'
              }
            >
              {renderText(item.payload.question)}
            </h3>
            {item.payload.answer && (
              <p className="mt-0.5 system-md-regular wrap-break-word whitespace-pre-wrap text-text-primary">
                {renderText(item.payload.answer)}
              </p>
            )}
          </div>
          {hasFields && (
            <ReadOnlyFormResponse
              replyLanguage={replyLanguage}
              fields={fields}
              sourceFields={sourceFormFields}
            />
          )}
        </article>
      )
    }

    if (item.kind === 'form' || item.kind === 'resource_select') return null

    if (item.kind === 'run_context') {
      return (
        <DifyBuilderCard
          category={t(($) => $['cardCategory.run'], { ns: 'difyBuilder' })}
          headline={item.payload.title || t(($) => $.failedRun, { ns: 'difyBuilder' })}
          invalidated={invalidated}
          meta={item.payload.error_code}
          status={{ state: 'failed' }}
        >
          <div className="flex flex-col gap-1">
            {!!item.payload.message && (
              <div className="system-xs-regular text-text-secondary">{item.payload.message}</div>
            )}
            <div className="truncate font-mono text-[11px] text-text-tertiary">
              {item.payload.run_id}
            </div>
          </div>
        </DifyBuilderCard>
      )
    }

    if (item.kind === 'preflight_context') {
      return <PreflightContextCard payload={item.payload} invalidated={invalidated} />
    }

    if (item.kind === 'plan') {
      return <PlanCard payload={item.payload} invalidated={invalidated} />
    }

    if (item.kind === 'test_result')
      return <TestResultCard payload={item.payload} invalidated={invalidated} />

    return null
  },
)
