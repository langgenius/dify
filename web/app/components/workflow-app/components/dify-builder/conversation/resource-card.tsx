import type { ConversationItem, DifyBuilderActionPayloadChange } from '../types'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCardShell } from '../cards/card-shell'

export const ResourceCard = memo(
  ({
    item,
    busy,
    interactive,
    invalidated,
    onActionPayloadChange,
  }: {
    item: Extract<ConversationItem, { kind: 'resource_select' }>
    busy: boolean
    interactive: boolean
    invalidated: boolean
    onActionPayloadChange: DifyBuilderActionPayloadChange
  }) => {
    const { t } = useTranslation()
    const resources = item.payload.recommended ?? []
    const policies = item.payload.conflict_policy_options ?? []
    const [selected, setSelected] = useState(() => resources.map((resource) => resource.id))
    const [policy, setPolicy] = useState(
      () => policies.find((option) => option.recommended)?.id ?? 'ask',
    )
    const frozen = busy || !interactive || invalidated

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
  },
)
