import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
} from '../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCardShell } from '../cards/card-shell'
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
    changesExpanded,
    invalidated,
    onActionPayloadChange,
    onActionValidityChange,
  }: {
    item: ConversationItem
    busy: boolean
    changesExpanded: boolean
    invalidated: boolean
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
  }) => {
    const { t } = useTranslation()

    if (item.kind === 'user' || item.kind === 'decision') {
      return (
        <div className="flex justify-end">
          <div className="max-w-[316px] rounded-2xl bg-background-default-dimmed px-4 py-3 text-[13px] leading-4 whitespace-pre-wrap text-text-primary">
            {item.payload.text}
          </div>
        </div>
      )
    }

    if (item.kind === 'assistant_turn') {
      if (!item.payload.reply_text) return invalidated ? null : <Thinking item={item} />
      return <AssistantReply text={item.payload.reply_text} />
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
          invalidated={invalidated}
          onActionPayloadChange={onActionPayloadChange}
          onActionValidityChange={onActionValidityChange}
        />
      )
    }

    if (item.kind === 'resource_select') {
      return (
        <ResourceCard
          item={item}
          busy={busy}
          invalidated={invalidated}
          onActionPayloadChange={onActionPayloadChange}
        />
      )
    }

    if (item.kind === 'run_context') {
      return (
        <DifyBuilderCardShell invalidated={invalidated} tone="error">
          <div className="system-xs-semibold text-text-primary">
            {item.payload.title || t(($) => $['difyBuilder.failedRun'], { ns: 'workflow' })}
          </div>
          {!!item.payload.message && (
            <div className="mt-1 system-xs-regular text-text-secondary">{item.payload.message}</div>
          )}
          <div className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
            {item.payload.run_id}
          </div>
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'preflight_context') {
      return (
        <DifyBuilderCardShell invalidated={invalidated} tone="warning">
          <div className="system-xs-semibold text-text-primary">
            {t(($) => $['difyBuilder.checklistIssues'], { ns: 'workflow' })}
          </div>
          {(item.payload.issues ?? []).map((issue) => (
            <div
              key={`${issue.node_id}-${issue.label}`}
              className="mt-1 system-xs-regular text-text-secondary"
            >
              {issue.label}
            </div>
          ))}
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'plan') {
      return (
        <DifyBuilderCardShell invalidated={invalidated}>
          <div className="system-sm-semibold text-text-primary">{item.payload.title}</div>
          <ol className="mt-2 list-decimal space-y-1 pl-4 system-xs-regular text-text-secondary">
            {(item.payload.items ?? []).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'challenge' || item.kind === 'error') {
      return (
        <DifyBuilderCardShell
          invalidated={invalidated}
          tone={item.kind === 'error' ? 'error' : 'warning'}
        >
          <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
          <div className="mt-1 system-xs-regular text-text-secondary">{item.payload.body}</div>
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'change_set') {
      return (
        <DifyBuilderCardShell invalidated={invalidated}>
          <div className="flex items-center justify-between">
            <span className="system-xs-semibold text-text-primary">
              {item.payload.scope || t(($) => $['difyBuilder.changes'], { ns: 'workflow' })}
            </span>
            <span className="bg-components-badge-gray-bg rounded-md px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
              {item.payload.count}
            </span>
          </div>
          {(changesExpanded || item.payload.full_diff_open) && (
            <ul className="mt-2 list-disc space-y-1 pl-4 system-xs-regular text-text-secondary">
              {item.payload.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'test_result') {
      return (
        <DifyBuilderCardShell
          invalidated={invalidated}
          tone={item.payload.tone === 'success' ? 'success' : 'neutral'}
        >
          <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
          <div className="mt-1 system-xs-regular text-text-tertiary">{item.payload.subtitle}</div>
          {!!item.payload.stats?.length && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {item.payload.stats.map((stat) => (
                <div key={`${stat.label}-${stat.value}`}>
                  <div className="system-sm-semibold text-text-primary">{stat.value}</div>
                  <div className="system-2xs-regular text-text-tertiary">{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'summary') {
      return (
        <DifyBuilderCardShell invalidated={invalidated}>
          {!!item.payload.title && (
            <div className="system-xs-semibold text-text-primary">{item.payload.title}</div>
          )}
          {(item.payload.items ?? []).map((text) => (
            <div key={text} className="mt-1 system-xs-regular text-text-secondary">
              {text}
            </div>
          ))}
          {(item.payload.rows ?? []).map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="mt-1 flex justify-between gap-3 system-xs-regular"
            >
              <span className="text-text-tertiary">{row.label}</span>
              <span className="text-right text-text-secondary">{row.value}</span>
            </div>
          ))}
        </DifyBuilderCardShell>
      )
    }

    if (item.kind === 'checkpoint' || item.kind === 'publish' || item.kind === 'build_learning') {
      const label =
        item.kind === 'checkpoint'
          ? item.payload.label
          : item.kind === 'publish'
            ? item.payload.version
            : item.payload.state
      return (
        <DifyBuilderCardShell
          invalidated={invalidated}
          tone={item.kind === 'publish' ? 'success' : 'info'}
        >
          <div className="system-xs-medium text-text-secondary">{label}</div>
        </DifyBuilderCardShell>
      )
    }

    return null
  },
)
