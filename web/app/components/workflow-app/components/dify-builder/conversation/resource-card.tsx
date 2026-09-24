import type { ConversationItem, DifyBuilderActionPayloadChange } from '../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
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
      <div className="-mx-1 flex flex-col gap-1">
        {resources.map((resource, index) => {
          const labelId = `${resourceListId}-${index}-label`
          const descriptionId = `${resourceListId}-${index}-description`
          return (
            <label
              key={resource.id}
              className="flex cursor-pointer items-start gap-2 rounded-[10px] border border-transparent bg-background-section px-3 py-2.5 text-text-secondary transition-colors hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover has-data-checked:border-state-accent-solid/30 has-data-checked:bg-util-colors-blue-brand-blue-brand-50 has-data-checked:text-text-primary has-data-checked:hover:border-state-accent-solid/30 has-data-checked:hover:bg-util-colors-blue-brand-blue-brand-50 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-state-accent-solid"
            >
              <span className="min-w-0 flex-1">
                <span id={labelId} className="block system-sm-medium wrap-break-word">
                  {resource.label}
                </span>
                <span
                  id={descriptionId}
                  className="block system-xs-regular wrap-break-word text-text-tertiary"
                >
                  {resource.meta}
                  {resource.meta && ' · '}
                  {resource.readiness === 'missing_config'
                    ? t(($) => $['difyBuilder.resourceNeedsAuthorization'], { ns: 'workflow' })
                    : t(($) => $['difyBuilder.resourceReady'], { ns: 'workflow' })}
                </span>
              </span>
              <Checkbox
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                checked={selected.includes(resource.id)}
                disabled={busy}
                className="focus-visible:ring-0"
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...selected, resource.id]
                    : selected.filter((id) => id !== resource.id)
                  setSelected(next)
                  emitPayload(next)
                }}
              />
            </label>
          )
        })}
      </div>
    )

    return resourceList
  },
)
