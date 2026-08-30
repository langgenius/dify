import type {
  DifyBuilderActionResponse,
  DifyBuilderConversationItemResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCardShell } from './cards/card-shell'
import {
  flattenConversationGroups,
  groupConversationItems,
} from './conversation/group-conversation-items'
import { DifyBuilderActionBar } from './interactions/action-bar'
import {
  isClientOnlyAction,
  placeConversationActions,
  resolveActionPayload,
} from './interactions/interaction-policy'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

const readStrings = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

const BuilderMark = () => (
  <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-util-colors-blue-blue-50">
    <span aria-hidden className="i-ri-sparkling-fill size-3.5 text-util-colors-blue-blue-600" />
  </span>
)

const Thinking = () => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 py-1 system-xs-medium text-text-tertiary">
      <BuilderMark />
      <span>{t(($) => $['difyBuilder.thinking'], { ns: 'workflow' })}</span>
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1 animate-pulse rounded-full bg-text-quaternary motion-reduce:animate-none"
            style={{ animationDelay: `${index * 180}ms`, animationDuration: '2s' }}
          />
        ))}
      </span>
    </div>
  )
}

type FormField = {
  key: string
  label: string
  type: string
  options: string[]
}

const readFormFields = (payload: Record<string, unknown>): FormField[] => {
  const fields = payload.fields
  if (!Array.isArray(fields)) return []
  return fields.flatMap((field) => {
    if (!isObject(field) || typeof field.key !== 'string' || typeof field.label !== 'string')
      return []
    return [
      {
        key: field.key,
        label: field.label,
        type: typeof field.type === 'string' ? field.type : 'text',
        options: Array.isArray(field.options)
          ? field.options.filter((option): option is string => typeof option === 'string')
          : [],
      },
    ]
  })
}

const FormCard = ({
  item,
  actions,
  busy,
  invalidated,
  pendingActionId,
  onSubmit,
}: {
  item: DifyBuilderConversationItemResponse
  actions: DifyBuilderActionResponse[]
  busy: boolean
  invalidated: boolean
  pendingActionId: string | null
  onSubmit: (actionId: string, values?: Record<string, unknown>) => Promise<void>
}) => {
  const fields = useMemo(() => readFormFields(item.payload), [item.payload])
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    isObject(item.payload.values) ? item.payload.values : {},
  )
  const submitAction = actions[0]
  const frozen = invalidated || item.payload.frozen === true || !submitAction

  return (
    <DifyBuilderCardShell active={actions.length > 0} invalidated={invalidated}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!submitAction || busy || pendingActionId !== null) return
          void onSubmit(submitAction.id, values)
        }}
      >
        {fields.map((field) => {
          if (field.type === 'bool') {
            return (
              <label
                key={field.key}
                className="flex items-center gap-2 py-1 system-xs-regular text-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  disabled={frozen || busy || pendingActionId !== null}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.checked }))
                  }
                />
                <span>{field.label}</span>
              </label>
            )
          }

          return (
            <label
              key={field.key}
              className="flex flex-col gap-1 system-xs-medium text-text-secondary"
            >
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select
                  value={readString(values, field.key)}
                  disabled={frozen || busy || pendingActionId !== null}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={readString(values, field.key)}
                  disabled={frozen || busy || pendingActionId !== null}
                  className="min-h-18 resize-y rounded-lg border border-components-input-border-active bg-components-input-bg-normal p-2 system-xs-regular text-text-primary outline-hidden"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              ) : (
                <input
                  type="text"
                  value={readString(values, field.key)}
                  disabled={frozen || busy || pendingActionId !== null}
                  className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              )}
            </label>
          )
        })}
        {actions.length > 0 && (
          <div className="border-t border-divider-subtle pt-3">
            <DifyBuilderActionBar
              actions={actions}
              busy={busy}
              pendingActionId={pendingActionId}
              submitActionId={submitAction?.id}
              onAction={(action) => void onSubmit(action.id, values)}
            />
          </div>
        )}
      </form>
    </DifyBuilderCardShell>
  )
}

const ResourceCard = ({
  item,
  actions,
  busy,
  invalidated,
  pendingActionId,
  onSubmit,
}: {
  item: DifyBuilderConversationItemResponse
  actions: DifyBuilderActionResponse[]
  busy: boolean
  invalidated: boolean
  pendingActionId: string | null
  onSubmit: (actionId: string, values?: Record<string, unknown>) => Promise<void>
}) => {
  const { t } = useTranslation()
  const recommended = Array.isArray(item.payload.recommended)
    ? item.payload.recommended.filter(isObject)
    : []
  const policies = Array.isArray(item.payload.conflict_policy_options)
    ? item.payload.conflict_policy_options.filter(isObject)
    : []
  const [selected, setSelected] = useState<string[]>(
    recommended.flatMap((resource) => (typeof resource.id === 'string' ? [resource.id] : [])),
  )
  const [policy, setPolicy] = useState(
    () => readString(policies.find((option) => option.recommended === true) ?? {}, 'id') || 'ask',
  )
  const submitAction = actions[0]

  return (
    <DifyBuilderCardShell active={actions.length > 0} invalidated={invalidated}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!submitAction || busy || pendingActionId !== null) return
          void onSubmit(submitAction.id, {
            resource_ids: selected,
            conflict_policy: policy,
          })
        }}
      >
        {recommended.map((resource) => {
          const id = readString(resource, 'id')
          if (!id) return null
          return (
            <div key={id} className="flex items-start gap-2 rounded-lg bg-background-section p-2">
              <input
                type="checkbox"
                aria-label={readString(resource, 'label') || id}
                checked={selected.includes(id)}
                disabled={!submitAction || busy || invalidated || pendingActionId !== null}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, id]
                      : current.filter((value) => value !== id),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block system-xs-medium text-text-primary">
                  {readString(resource, 'label')}
                </span>
                <span className="block truncate system-2xs-regular text-text-tertiary">
                  {readString(resource, 'meta')}
                </span>
              </span>
            </div>
          )
        })}
        {policies.length > 0 && (
          <select
            value={policy}
            disabled={!submitAction || busy || invalidated || pendingActionId !== null}
            aria-label={t(($) => $['difyBuilder.conflictPolicy'], { ns: 'workflow' })}
            className="h-8 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden"
            onChange={(event) => setPolicy(event.target.value)}
          >
            {policies.map((option) => {
              const id = readString(option, 'id')
              return (
                <option key={id} value={id}>
                  {readString(option, 'label')}
                </option>
              )
            })}
          </select>
        )}
        {actions.length > 0 && (
          <div className="border-t border-divider-subtle pt-3">
            <DifyBuilderActionBar
              actions={actions}
              busy={busy}
              pendingActionId={pendingActionId}
              submitActionId={submitAction?.id}
              onAction={(action) =>
                void onSubmit(action.id, {
                  resource_ids: selected,
                  conflict_policy: policy,
                })
              }
            />
          </div>
        )}
      </form>
    </DifyBuilderCardShell>
  )
}

const ChangeSetCard = ({
  item,
  actions,
  busy,
  invalidated,
  pendingActionId,
  onSubmit,
}: {
  item: DifyBuilderConversationItemResponse
  actions: DifyBuilderActionResponse[]
  busy: boolean
  invalidated: boolean
  pendingActionId: string | null
  onSubmit: (actionId: string, values?: Record<string, unknown>) => Promise<void>
}) => {
  const { t } = useTranslation()
  const payload = item.payload
  const changes = readStrings(payload, 'changes')
  const [expanded, setExpanded] = useState(payload.full_diff_open === true)

  return (
    <DifyBuilderCardShell
      active={actions.length > 0}
      invalidated={invalidated}
      footer={
        actions.length > 0 ? (
          <DifyBuilderActionBar
            actions={actions}
            busy={busy}
            pendingActionId={pendingActionId}
            isExpanded={(actionId) => (actionId === 'view_changes' ? expanded : undefined)}
            onAction={(action) => {
              if (isClientOnlyAction(action.id)) {
                setExpanded((value) => !value)
                return
              }
              void onSubmit(action.id)
            }}
          />
        ) : undefined
      }
    >
      <div className="flex items-center justify-between">
        <span className="system-xs-semibold text-text-primary">
          {readString(payload, 'scope') ||
            t(($) => $['difyBuilder.changes'], { ns: 'workflow' })}
        </span>
        <span className="bg-components-badge-gray-bg rounded-md px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
          {typeof payload.count === 'number' ? payload.count : changes.length}
        </span>
      </div>
      {expanded && (
        <ul className="mt-2 list-disc space-y-1 pl-4 system-xs-regular text-text-secondary">
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
    </DifyBuilderCardShell>
  )
}

const ConversationCard = ({
  item,
  actions,
  busy,
  invalidated,
  pendingActionId,
  onSubmit,
}: {
  item: DifyBuilderConversationItemResponse
  actions: DifyBuilderActionResponse[]
  busy: boolean
  invalidated: boolean
  pendingActionId: string | null
  onSubmit: (actionId: string, values?: Record<string, unknown>) => Promise<void>
}) => {
  const { t } = useTranslation()
  const payload = item.payload
  const actionBar =
    actions.length > 0 ? (
      <DifyBuilderActionBar
        actions={actions}
        busy={busy}
        pendingActionId={pendingActionId}
        onAction={(action) => void onSubmit(action.id)}
      />
    ) : undefined

  if (item.kind === 'user' || item.kind === 'decision') {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-background-default-subtle px-3 py-2 system-sm-regular text-text-primary">
          {readString(payload, 'text')}
        </div>
        {actionBar}
      </div>
    )
  }
  if (item.kind === 'assistant_turn') {
    const reply = readString(payload, 'reply_text')
    if (!reply) return invalidated ? null : <Thinking />
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <BuilderMark />
          <div className="min-w-0 pt-0.5 system-sm-regular leading-5 text-text-secondary">
            {reply}
          </div>
        </div>
        {actionBar && <div className="ml-8">{actionBar}</div>}
      </div>
    )
  }
  if (item.kind === 'notice') {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
          {readString(payload, 'text')}
        </div>
        {actionBar}
      </div>
    )
  }
  if (item.kind === 'form') {
    return (
      <FormCard
        item={item}
        actions={actions}
        busy={busy}
        invalidated={invalidated}
        pendingActionId={pendingActionId}
        onSubmit={onSubmit}
      />
    )
  }
  if (item.kind === 'resource_select') {
    return (
      <ResourceCard
        item={item}
        actions={actions}
        busy={busy}
        invalidated={invalidated}
        pendingActionId={pendingActionId}
        onSubmit={onSubmit}
      />
    )
  }
  if (item.kind === 'plan') {
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        footer={actionBar}
      >
        <div className="system-sm-semibold text-text-primary">{readString(payload, 'title')}</div>
        <ol className="mt-2 list-decimal space-y-1 pl-4 system-xs-regular text-text-secondary">
          {readStrings(payload, 'items').map((itemText) => (
            <li key={itemText}>{itemText}</li>
          ))}
        </ol>
      </DifyBuilderCardShell>
    )
  }
  if (item.kind === 'challenge' || item.kind === 'error') {
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        tone={item.kind === 'error' ? 'error' : 'warning'}
        footer={actionBar}
      >
        <div className="system-xs-semibold text-text-primary">{readString(payload, 'title')}</div>
        <div className="mt-1 system-xs-regular text-text-secondary">
          {readString(payload, 'body')}
        </div>
      </DifyBuilderCardShell>
    )
  }
  if (item.kind === 'change_set') {
    return (
      <ChangeSetCard
        item={item}
        actions={actions}
        busy={busy}
        invalidated={invalidated}
        pendingActionId={pendingActionId}
        onSubmit={onSubmit}
      />
    )
  }
  if (item.kind === 'test_result') {
    const stats = Array.isArray(payload.stats) ? payload.stats.filter(isObject) : []
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        tone={readString(payload, 'tone') === 'success' ? 'success' : 'neutral'}
        footer={actionBar}
      >
        <div className="system-xs-semibold text-text-primary">{readString(payload, 'title')}</div>
        <div className="mt-1 system-xs-regular text-text-tertiary">
          {readString(payload, 'subtitle')}
        </div>
        {stats.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {stats.map((stat) => (
              <div key={`${readString(stat, 'label')}-${readString(stat, 'value')}`}>
                <div className="system-sm-semibold text-text-primary">
                  {readString(stat, 'value')}
                </div>
                <div className="system-2xs-regular text-text-tertiary">
                  {readString(stat, 'label')}
                </div>
              </div>
            ))}
          </div>
        )}
      </DifyBuilderCardShell>
    )
  }
  if (item.kind === 'summary') {
    const rows = Array.isArray(payload.rows) ? payload.rows.filter(isObject) : []
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        footer={actionBar}
      >
        <div className="system-xs-semibold text-text-primary">{readString(payload, 'title')}</div>
        {readStrings(payload, 'items').map((summaryItem) => (
          <div key={summaryItem} className="mt-1 system-xs-regular text-text-secondary">
            {summaryItem}
          </div>
        ))}
        {rows.map((row) => (
          <div
            key={`${readString(row, 'label')}-${readString(row, 'value')}`}
            className="mt-1 flex justify-between gap-3 system-xs-regular"
          >
            <span className="text-text-tertiary">{readString(row, 'label')}</span>
            <span className="text-right text-text-secondary">{readString(row, 'value')}</span>
          </div>
        ))}
      </DifyBuilderCardShell>
    )
  }
  if (item.kind === 'run_context' || item.kind === 'preflight_context') {
    const issues = Array.isArray(payload.issues) ? payload.issues.filter(isObject) : []
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        tone={item.kind === 'run_context' ? 'error' : 'warning'}
        footer={actionBar}
      >
        <div className="system-xs-semibold text-text-primary">
          {item.kind === 'run_context'
            ? readString(payload, 'title') ||
              t(($) => $['difyBuilder.failedRun'], { ns: 'workflow' })
            : t(($) => $['difyBuilder.checklistIssues'], { ns: 'workflow' })}
        </div>
        {readString(payload, 'run_id') && (
          <div className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
            {readString(payload, 'run_id')}
          </div>
        )}
        {issues.map((issue) => (
          <div
            key={`${readString(issue, 'node_id')}-${readString(issue, 'label')}`}
            className="mt-1 system-xs-regular text-text-secondary"
          >
            {readString(issue, 'label')}
          </div>
        ))}
      </DifyBuilderCardShell>
    )
  }
  if (item.kind === 'checkpoint' || item.kind === 'publish' || item.kind === 'build_learning') {
    return (
      <DifyBuilderCardShell
        active={actions.length > 0}
        invalidated={invalidated}
        tone={item.kind === 'publish' ? 'success' : 'info'}
        footer={actionBar}
      >
        <div className="system-xs-medium text-text-secondary">
          {readString(payload, 'label') ||
            readString(payload, 'version') ||
            readString(payload, 'state')}
        </div>
      </DifyBuilderCardShell>
    )
  }
  return null
}

export const DifyBuilderConversation = ({
  items,
  actions,
  busy,
  interrupted,
  checklistPayload,
  onAction,
}: {
  items: DifyBuilderConversationItemResponse[]
  actions: DifyBuilderActionResponse[]
  busy: boolean
  interrupted: boolean
  checklistPayload: Record<string, unknown>
  onAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
}) => {
  const { t } = useTranslation()
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const groups = useMemo(() => groupConversationItems(items), [items])
  const actionPlacements = useMemo(
    () => placeConversationActions(groups, actions),
    [actions, groups],
  )
  const hasThinkingTurn = useMemo(
    () =>
      flattenConversationGroups(groups).some(
        ({ item, invalidated }) =>
          !invalidated && item.kind === 'assistant_turn' && !readString(item.payload, 'reply_text'),
      ),
    [groups],
  )

  const handleAction = async (actionId: string, payload: Record<string, unknown> = {}) => {
    if (busy || pendingActionId !== null || isClientOnlyAction(actionId)) return

    setPendingActionId(actionId)
    try {
      await onAction(actionId, resolveActionPayload(actionId, payload, checklistPayload))
    } finally {
      setPendingActionId((current) => (current === actionId ? null : current))
    }
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      {interrupted && (
        <div className="rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning">
          {t(($) => $['difyBuilder.interrupted'], { ns: 'workflow' })}
        </div>
      )}
      {groups.map((group) => {
        if (group.type === 'standalone') {
          return (
            <ConversationCard
              key={`${group.item.seq}-${group.item.kind}`}
              item={group.item}
              actions={actionPlacements.get(group.item.seq) ?? []}
              busy={busy}
              invalidated={false}
              pendingActionId={pendingActionId}
              onSubmit={handleAction}
            />
          )
        }

        return (
          <div
            key={`${group.turn.seq}-${group.turn.kind}`}
            data-card-state={group.invalidated ? 'invalidated' : 'valid'}
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
              actions={actionPlacements.get(group.turn.seq) ?? []}
              busy={busy}
              invalidated={group.invalidated}
              pendingActionId={pendingActionId}
              onSubmit={handleAction}
            />
            {group.cards.map((item) => (
              <ConversationCard
                key={`${item.seq}-${item.kind}`}
                item={item}
                actions={actionPlacements.get(item.seq) ?? []}
                busy={busy}
                invalidated={group.invalidated}
                pendingActionId={pendingActionId}
                onSubmit={handleAction}
              />
            ))}
          </div>
        )
      })}
      {busy && !hasThinkingTurn && <Thinking />}
    </div>
  )
}
