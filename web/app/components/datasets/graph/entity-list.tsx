'use client'

import type { GraphEntityResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type EntityListProps = {
  entities: GraphEntityResponse[]
  focusedEntityId?: string
  onEntityClick?: (entity: GraphEntityResponse) => void
}

/**
 * Text view of the same nodes drawn in the diagram.
 *
 * This is the table view the diagram needs to stay accessible: node identity in
 * the chart is carried by labels and this list, never by color alone, and the
 * exact mention counts are readable here without hovering.
 */
const EntityList = ({ entities, focusedEntityId, onEntityClick }: EntityListProps) => {
  const { t } = useTranslation()

  const sorted = useMemo(() => [...entities].sort((a, b) => b.frequency - a.frequency), [entities])

  return (
    <div className="flex w-70 shrink-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg">
      <div className="shrink-0 px-3 pt-3 pb-2 system-xs-medium-uppercase text-text-tertiary">
        {t(($) => $['graph.entitiesInView'], { ns: 'datasetSettings', count: sorted.length })}
      </div>
      <ul className="min-h-0 grow overflow-y-auto px-1.5 pb-2">
        {sorted.map((entity) => (
          <li key={entity.id}>
            <button
              type="button"
              onClick={() => onEntityClick?.(entity)}
              className={cn(
                'flex w-full flex-col items-start gap-y-0.5 rounded-lg px-2 py-1.5 text-left',
                'hover:bg-state-base-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-components-input-border-active',
                entity.id === focusedEntityId && 'bg-state-accent-active',
              )}
            >
              <span className="w-full truncate system-sm-medium text-text-secondary">
                {entity.display_name}
              </span>
              <span className="flex w-full items-center gap-x-1 system-xs-regular text-text-tertiary">
                <span className="truncate">{entity.entity_type}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  {t(($) => $['graph.mentionCount'], {
                    ns: 'datasetSettings',
                    count: entity.frequency,
                  })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default memo(EntityList)
