import type { FC } from 'react'
import type { KnowledgeRetrievalV2NodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

const Node: FC<NodeProps<KnowledgeRetrievalV2NodeType>> = ({ data }) => {
  const { t } = useTranslation()
  const summaries = new Map(
    (data._control_spaces ?? []).map((space) => [space.control_space_id, space]),
  )
  if (!data.control_space_ids?.length) return null

  return (
    <div className="mb-1 space-y-1 px-3 py-1">
      {data.control_space_ids.map((controlSpaceId) => {
        const space = summaries.get(controlSpaceId)
        return (
          <div
            key={controlSpaceId}
            className="flex h-6.5 items-center gap-1 rounded-md bg-workflow-block-parma-bg px-1.5"
          >
            <span aria-hidden>{space?.icon || '📗'}</span>
            <span className="w-0 grow truncate system-xs-regular text-text-secondary">
              {space?.name ?? controlSpaceId}
            </span>
          </div>
        )
      })}
      <div className="px-1 system-2xs-medium-uppercase text-text-tertiary">
        {data.mode ??
          t(($) => $['nodes.knowledgeRetrievalV2.mode.spaceDefault'], { ns: 'workflow' })}{' '}
        · top {data.top_n}
      </div>
    </div>
  )
}

export default memo(Node)
