import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
} from '../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'
import { ExecutionProgress } from './execution-progress'
import { FormCard } from './form-card'
import { ResourceCard } from './resource-card'
import { Thinking } from './thinking'

export const AssistantReply = ({ text }: { text: string }) => (
  <div className="px-1 text-sm leading-5 tracking-[-0.07px] whitespace-pre-wrap text-text-primary">
    {text}
  </div>
)

export const ConversationCard = memo(
  ({
    item,
    busy,
    interactive,
    invalidated,
    formId,
    onActionPayloadChange,
    onActionValidityChange,
    onFormSubmit,
  }: {
    item: ConversationItem
    busy: boolean
    interactive: boolean
    changesExpanded: boolean
    invalidated: boolean
    formId?: string
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
    onFormSubmit?: () => void
  }) => {
    const { t } = useTranslation()

    if (item.kind === 'challenge' || item.kind === 'change_set' || item.kind === 'checkpoint')
      return null

    if (item.kind === 'user' || item.kind === 'decision') {
      return (
        <article className="flex justify-end">
          <h3 className="sr-only">{t(($) => $.you, { ns: 'common' })}</h3>
          <div className="max-w-[316px] rounded-2xl bg-background-default-dimmed px-4 py-3 text-[13px] leading-4 whitespace-pre-wrap text-text-primary">
            {item.payload.text}
          </div>
        </article>
      )
    }

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

    if (item.kind === 'form') {
      return (
        <FormCard
          item={item}
          busy={busy}
          formId={formId}
          interactive={interactive}
          invalidated={invalidated}
          onActionPayloadChange={onActionPayloadChange}
          onActionValidityChange={onActionValidityChange}
          onSubmit={onFormSubmit}
        />
      )
    }

    if (item.kind === 'resource_select') {
      return (
        <ResourceCard
          item={item}
          busy={busy}
          interactive={interactive}
          invalidated={invalidated}
          onActionPayloadChange={onActionPayloadChange}
        />
      )
    }

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
      const issues = item.payload.issues ?? []
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.checks'], { ns: 'workflow' })}
          headline={t(($) => $['difyBuilder.checklistIssues'], { ns: 'workflow' })}
          invalidated={invalidated}
          meta={String(item.payload.issue_count)}
          status={item.payload.issue_count > 0 ? { state: 'blocked' } : undefined}
        >
          {issues.length > 0 ? (
            <div className="flex flex-col gap-1">
              {issues.map((issue) => (
                <div
                  key={`${issue.node_id}-${issue.label}`}
                  className="system-xs-regular text-text-secondary"
                >
                  {issue.label}
                </div>
              ))}
            </div>
          ) : undefined}
        </DifyBuilderCard>
      )
    }

    if (item.kind === 'plan') {
      const items = item.payload.items ?? []
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.plan'], { ns: 'workflow' })}
          headline={item.payload.title}
          invalidated={invalidated}
          meta={item.payload.version_tag}
          subheadline={item.payload.subtitle}
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

    if (item.kind === 'error') {
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.error'], { ns: 'workflow' })}
          headline={item.payload.title}
          invalidated={invalidated}
          status={{ state: 'failed' }}
          subheadline={item.payload.body}
        />
      )
    }

    if (item.kind === 'test_result') {
      const stats = item.payload.stats ?? []
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.test'], { ns: 'workflow' })}
          headline={item.payload.title}
          invalidated={invalidated}
          status={
            item.payload.tone === 'success'
              ? { label: t(($) => $['api.success'], { ns: 'common' }), state: 'done' }
              : item.payload.tone === 'error'
                ? { label: t(($) => $['api.actionFailed'], { ns: 'common' }), state: 'failed' }
                : undefined
          }
          subheadline={item.payload.subtitle}
        >
          {stats.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {stats.map((stat) => (
                <div key={`${stat.label}-${stat.value}`}>
                  <div className="system-sm-semibold text-text-primary">{stat.value}</div>
                  <div className="system-2xs-regular text-text-tertiary">{stat.label}</div>
                </div>
              ))}
            </div>
          ) : undefined}
        </DifyBuilderCard>
      )
    }

    if (item.kind === 'summary') {
      const items = item.payload.items ?? []
      const rows = item.payload.rows ?? []
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.summary'], { ns: 'workflow' })}
          headline={item.payload.title}
          invalidated={invalidated}
          status={item.payload.variant === 'completion' ? { state: 'done' } : undefined}
        >
          {items.length > 0 || rows.length > 0 ? (
            <div className="flex flex-col gap-1">
              {items.map((text) => (
                <div key={text} className="system-xs-regular text-text-secondary">
                  {text}
                </div>
              ))}
              {rows.map((row) => (
                <div
                  key={`${row.label}-${row.value}`}
                  className="flex justify-between gap-3 system-xs-regular"
                >
                  <span className="text-text-tertiary">{row.label}</span>
                  <span className="text-right text-text-secondary">{row.value}</span>
                </div>
              ))}
            </div>
          ) : undefined}
        </DifyBuilderCard>
      )
    }

    if (item.kind === 'publish') {
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.publish'], { ns: 'workflow' })}
          invalidated={invalidated}
          meta={item.payload.version}
          status={{ label: item.payload.badge, state: 'done' }}
        />
      )
    }

    if (item.kind === 'build_learning') {
      const statusState =
        item.payload.state === 'accepted'
          ? ('done' as const)
          : item.payload.state === 'skipped'
            ? ('skipped' as const)
            : item.payload.state === 'pending'
              ? ('waiting' as const)
              : undefined
      return (
        <DifyBuilderCard
          category={t(($) => $['difyBuilder.cardCategory.learning'], { ns: 'workflow' })}
          invalidated={invalidated}
          meta={item.payload.policy}
          status={{ label: item.payload.state, state: statusState }}
        />
      )
    }

    return null
  },
)
