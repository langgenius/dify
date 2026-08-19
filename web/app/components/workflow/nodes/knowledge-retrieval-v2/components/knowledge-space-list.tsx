'use client'

import type { FC } from 'react'
import type { KnowledgeRetrievalV2SpaceSummary } from '../types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  list: KnowledgeRetrievalV2SpaceSummary[]
  onChange: (spaces: KnowledgeRetrievalV2SpaceSummary[]) => void
  readonly?: boolean
}>

const KnowledgeSpaceList: FC<Props> = ({ list, onChange, readonly }) => {
  const { t } = useTranslation()
  const [removeHoveredId, setRemoveHoveredId] = useState<string>()
  const remove = useCallback(
    (controlSpaceId: string) => {
      onChange(list.filter((space) => space.control_space_id !== controlSpaceId))
    },
    [list, onChange],
  )

  if (!list.length) {
    return (
      <div className="cursor-default rounded-lg bg-background-section p-3 text-center text-xs text-text-tertiary select-none">
        {t(($) => $['datasetConfig.knowledgeTip'], { ns: 'appDebug' })}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {list.map((space) => {
        const removeHovered = removeHoveredId === space.control_space_id
        return (
          <div
            key={space.control_space_id}
            className={`group/knowledge-space flex h-10 items-center justify-between rounded-lg border-[0.5px] px-2 ${
              removeHovered
                ? 'border-state-destructive-border bg-state-destructive-hover'
                : 'border-components-panel-border-subtle bg-components-panel-on-panel-item-bg hover:bg-components-panel-on-panel-item-bg-hover'
            }`}
          >
            <div className="flex w-0 grow items-center space-x-1.5">
              <span aria-hidden className="shrink-0">
                {space.icon || '📗'}
              </span>
              <span className="w-0 grow truncate system-sm-medium text-text-secondary">
                {space.name}
              </span>
            </div>
            {!readonly && (
              <div className="ml-2 hidden shrink-0 group-hover/knowledge-space:block">
                <IconButton
                  aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                  tone="destructive"
                  onClick={() => remove(space.control_space_id)}
                  onMouseEnter={() => setRemoveHoveredId(space.control_space_id)}
                  onMouseLeave={() => setRemoveHoveredId(undefined)}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                </IconButton>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default KnowledgeSpaceList
