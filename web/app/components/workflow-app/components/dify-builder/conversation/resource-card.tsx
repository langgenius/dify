import type { ConversationItem, DifyBuilderActionPayloadChange } from '../types'
import { memo, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
export const ResourceCard = memo(
  ({
    item,
    busy,
    onActionPayloadChange,
  }: {
    item: Extract<ConversationItem, { kind: 'resource_select' }>
    busy: boolean
    onActionPayloadChange: DifyBuilderActionPayloadChange
  }) => {
    const { t } = useTranslation(['workflow'])
    const resources = item.payload.recommended ?? []
    const resourceListId = useId()
    const [selected, setSelected] = useState(() => resources.map((resource) => resource.id))
    const emitPayload = (resourceIds: string[]) => {
      onActionPayloadChange('confirm_resources', {
        resource_ids: resourceIds,
      })
    }

    const resourceList = (
      <div className="flex flex-col gap-2">
        {resources.map((resource, index) => {
          const labelId = `${resourceListId}-${index}-label`
          const descriptionId = `${resourceListId}-${index}-description`
          return (
            <label
              key={resource.id}
              className="flex items-start gap-2 rounded-lg bg-background-section p-2"
            >
              <input
                type="checkbox"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                checked={selected.includes(resource.id)}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, resource.id]
                    : selected.filter((id) => id !== resource.id)
                  setSelected(next)
                  emitPayload(next)
                }}
              />
              <span className="min-w-0">
                <span id={labelId} className="block system-xs-medium text-text-primary">
                  {resource.label}
                </span>
                <span
                  id={descriptionId}
                  className="block system-2xs-regular wrap-break-word text-text-tertiary"
                >
                  {resource.meta}
                  {resource.meta && ' · '}
                  {resource.readiness === 'missing_config'
                    ? t(($) => $['difyBuilder.resourceNeedsAuthorization'], { ns: 'workflow' })
                    : t(($) => $['difyBuilder.resourceReady'], { ns: 'workflow' })}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    )

    return resourceList
  },
)
