import type { ConversationItem } from '@dify/contracts/dify-builder'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCardShell } from './cards/card-shell'
import { groupConversationItems } from './conversation/group-conversation-items'

type ActionPayloadChange = (actionId: string, payload: Record<string, unknown>) => void

const Thinking = ({ item }: { item?: Extract<ConversationItem, { kind: 'assistant_turn' }> }) => {
  const { t } = useTranslation()
  const steps = item?.payload.trace.steps ?? []

  return (
    <details className="group min-h-8" open={steps.some((step) => step.state === 'active')}>
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-custom-public-app-builder-thinking size-[18px] shrink-0" />
        <span>{t(($) => $['difyBuilder.thinking'], { ns: 'workflow' })}</span>
        <span className="grow" />
        {steps.length > 0 && (
          <span
            aria-hidden
            className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
          />
        )}
      </summary>
      {steps.length > 0 && (
        <ol className="ml-5 space-y-1 border-l border-divider-subtle py-1 pl-3 text-xs text-text-tertiary">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full bg-text-quaternary',
                  step.state === 'active' &&
                    'animate-pulse bg-text-accent motion-reduce:animate-none',
                  step.state === 'done' && 'bg-text-success',
                )}
              />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}

const FormCard = ({
  item,
  busy,
  invalidated,
  onActionPayloadChange,
}: {
  item: Extract<ConversationItem, { kind: 'form' }>
  busy: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
}) => {
  const [values, setValues] = useState<Record<string, unknown>>(() => item.payload.values ?? {})
  const actionId =
    item.payload.variant === 'build_requirements'
      ? 'submit_requirements'
      : item.payload.variant === 'edit_rules'
        ? 'submit_edit_rules'
        : 'provide_testdata'
  const frozen = busy || invalidated || item.payload.frozen === true

  const updateValues = (key: string, value: unknown) => {
    setValues((current) => {
      const next = { ...current, [key]: value }
      onActionPayloadChange(actionId, next)
      return next
    })
  }

  return (
    <DifyBuilderCardShell invalidated={invalidated}>
      <div className="flex flex-col gap-3">
        {(item.payload.fields ?? []).map((field) => {
          if (field.type === 'bool') {
            return (
              <label
                key={field.key}
                className="flex items-center gap-2 py-1 system-xs-regular text-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  disabled={frozen}
                  onChange={(event) => updateValues(field.key, event.target.checked)}
                />
                <span>{field.label}</span>
              </label>
            )
          }

          const rawValue = values[field.key]
          const value = typeof rawValue === 'string' ? rawValue : ''
          return (
            <label
              key={field.key}
              className="flex flex-col gap-1 system-xs-medium text-text-secondary"
            >
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select
                  value={value}
                  disabled={frozen}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) => updateValues(field.key, event.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={value}
                  disabled={frozen}
                  className="min-h-18 resize-y rounded-lg border border-components-input-border-active bg-components-input-bg-normal p-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) => updateValues(field.key, event.target.value)}
                />
              ) : (
                <input
                  type="text"
                  value={value}
                  disabled={frozen}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onChange={(event) => updateValues(field.key, event.target.value)}
                />
              )}
            </label>
          )
        })}
      </div>
    </DifyBuilderCardShell>
  )
}

const ResourceCard = ({
  item,
  busy,
  invalidated,
  onActionPayloadChange,
}: {
  item: Extract<ConversationItem, { kind: 'resource_select' }>
  busy: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
}) => {
  const { t } = useTranslation()
  const resources = item.payload.recommended ?? []
  const policies = item.payload.conflict_policy_options ?? []
  const [selected, setSelected] = useState(() => resources.map((resource) => resource.id))
  const [policy, setPolicy] = useState(
    () => policies.find((option) => option.recommended)?.id ?? 'ask',
  )
  const frozen = busy || invalidated

  const emitPayload = (resourceIds: string[], conflictPolicy: string) => {
    onActionPayloadChange('confirm_resources', {
      resource_ids: resourceIds,
      conflict_policy: conflictPolicy,
    })
  }

  return (
    <DifyBuilderCardShell invalidated={invalidated}>
      <div className="flex flex-col gap-2">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="flex items-start gap-2 rounded-lg bg-background-section p-2"
          >
            <input
              type="checkbox"
              aria-label={resource.label}
              checked={selected.includes(resource.id)}
              disabled={frozen}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, resource.id]
                  : selected.filter((id) => id !== resource.id)
                setSelected(next)
                emitPayload(next, policy)
              }}
            />
            <span className="min-w-0">
              <span className="block system-xs-medium text-text-primary">{resource.label}</span>
              <span className="block truncate system-2xs-regular text-text-tertiary">
                {resource.meta}
              </span>
            </span>
          </div>
        ))}
        {policies.length > 0 && (
          <label className="flex flex-col gap-1 system-xs-medium text-text-secondary">
            <span>{t(($) => $['difyBuilder.conflictPolicy'], { ns: 'workflow' })}</span>
            <select
              value={policy}
              disabled={frozen}
              className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              onChange={(event) => {
                setPolicy(event.target.value)
                emitPayload(selected, event.target.value)
              }}
            >
              {policies.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </DifyBuilderCardShell>
  )
}

const ConversationCard = ({
  item,
  busy,
  changesExpanded,
  invalidated,
  onActionPayloadChange,
}: {
  item: ConversationItem
  busy: boolean
  changesExpanded: boolean
  invalidated: boolean
  onActionPayloadChange: ActionPayloadChange
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
    return (
      <div className="px-1 text-sm leading-5 tracking-[-0.07px] whitespace-pre-wrap text-text-primary">
        {item.payload.reply_text}
      </div>
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
        invalidated={invalidated}
        onActionPayloadChange={onActionPayloadChange}
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
}

export const DifyBuilderConversation = ({
  busy,
  changesExpanded,
  interrupted,
  items,
  onActionPayloadChange,
}: {
  busy: boolean
  changesExpanded: boolean
  interrupted: boolean
  items: ConversationItem[]
  onActionPayloadChange: ActionPayloadChange
}) => {
  const { t } = useTranslation()
  const groups = useMemo(() => groupConversationItems(items), [items])
  const hasThinkingTurn = items.some(
    (item) => item.kind === 'assistant_turn' && !item.payload.reply_text,
  )

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {interrupted && (
        <div
          role="alert"
          className="rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
        >
          {t(($) => $['difyBuilder.interrupted'], { ns: 'workflow' })}
        </div>
      )}
      {groups.map((group) => {
        if (group.type === 'standalone') {
          return (
            <ConversationCard
              key={`${group.item.seq}-${group.item.kind}`}
              item={group.item}
              busy={busy}
              changesExpanded={changesExpanded}
              invalidated={false}
              onActionPayloadChange={onActionPayloadChange}
            />
          )
        }

        return (
          <div
            key={`${group.turn.seq}-${group.turn.kind}`}
            className={cn('flex flex-col gap-3', group.invalidated && 'opacity-70')}
          >
            {group.invalidated && (
              <div className="flex items-center gap-1.5 px-1 system-2xs-medium-uppercase text-text-tertiary">
                <span aria-hidden className="i-ri-history-line size-3.5" />
                <span>{t(($) => $['difyBuilder.invalidated'], { ns: 'workflow' })}</span>
              </div>
            )}
            <ConversationCard
              item={group.turn}
              busy={busy}
              changesExpanded={changesExpanded}
              invalidated={group.invalidated}
              onActionPayloadChange={onActionPayloadChange}
            />
            {group.cards.map((item) => (
              <ConversationCard
                key={`${item.seq}-${item.kind}`}
                item={item}
                busy={busy}
                changesExpanded={changesExpanded}
                invalidated={group.invalidated}
                onActionPayloadChange={onActionPayloadChange}
              />
            ))}
          </div>
        )
      })}
      {busy && !hasThinkingTurn && <Thinking />}
    </div>
  )
}
