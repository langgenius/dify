import type { ConversationItem } from '../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { DifyBuilderCard } from '../cards/card-shell'
import { ExecutionProgress } from './execution-progress'
import { PreflightContextCard } from './preflight-context-card'
import { Thinking } from './thinking'

export const AssistantReply = ({ text }: { text: string }) => (
  <Markdown content={text} className="px-1 text-sm! leading-5! tracking-[-0.07px]" />
)

export const UserMessage = memo(({ text }: { text: string }) => {
  const { t } = useTranslation(['common'])

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
  ({ item, invalidated }: { item: ConversationItem; invalidated: boolean }) => {
    const { t } = useTranslation(['workflow'])

    if (item.kind === 'user' || item.kind === 'decision')
      return <UserMessage text={item.payload.text} />

    if (item.kind === 'assistant_turn') {
      const hasExecution = (item.payload.execution.activities?.length ?? 0) > 0
      const hasReasoning = Boolean(item.payload.reasoning_text?.trim())
      const hasReply = Boolean(item.payload.reply_text)
      if (!hasExecution && !hasReasoning && !hasReply) return null
      return (
        <article className="flex flex-col gap-2">
          <h3 className="sr-only">{t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}</h3>
          {hasExecution ? <ExecutionProgress execution={item.payload.execution} /> : null}
          <Thinking text={item.payload.reasoning_text} />
          {item.payload.reply_text ? <AssistantReply text={item.payload.reply_text} /> : null}
        </article>
      )
    }

    if (item.kind === 'notice') {
      return (
        <div className="rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
          {item.payload.text}
        </div>
      )
    }

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
              {item.payload.question}
            </h3>
            {item.payload.answer && (
              <p className="mt-0.5 system-md-regular wrap-break-word whitespace-pre-wrap text-text-primary">
                {item.payload.answer}
              </p>
            )}
          </div>
          {hasFields && (
            <dl className="m-0">
              {fields.map((field) => (
                <div key={field.key} className="rounded-lg px-2 py-1.5 wrap-break-word">
                  <dt className="system-sm-regular text-text-tertiary">{field.label}</dt>
                  <dd className="m-0 mt-0.5 system-md-regular whitespace-pre-wrap text-text-primary">
                    {field.display_value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      )
    }

    if (item.kind === 'form' || item.kind === 'resource_select') return null

    if (item.kind === 'run_context') {
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.run'], { ns: 'workflow' })}
          headline={item.payload.title || t(($) => $['difyBuilder.failedRun'], { ns: 'workflow' })}
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
      const items = item.payload.items ?? []
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.plan'], { ns: 'workflow' })}
          headline={item.payload.title}
          invalidated={invalidated}
        >
          {items.length > 0 ? (
            <ol className="flex flex-col py-1">
              {items.map((text, index) => (
                <li key={text} className="flex items-start gap-4 py-1">
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-md bg-components-badge-bg-gray-soft system-2xs-semibold-uppercase text-text-tertiary"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 system-sm-regular wrap-break-word text-text-primary">
                    {text}
                  </span>
                </li>
              ))}
            </ol>
          ) : undefined}
        </DifyBuilderCard>
      )
    }

    if (item.kind === 'test_result') {
      const succeeded = item.payload.status === 'succeeded'
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.test'], { ns: 'workflow' })}
          headline={t(
            ($) =>
              succeeded ? $['common.workflowProcessSucceeded'] : $['common.workflowProcessFailed'],
            { ns: 'workflow' },
          )}
          invalidated={invalidated}
          status={{ state: succeeded ? 'done' : 'failed' }}
          subheadline={succeeded ? undefined : item.payload.failure_reason}
        />
      )
    }

    return null
  },
)
