import type { FC } from 'react'
import type { SnippetListItem } from '@/types/snippet'
import { useMemo } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import BlockIcon from '../../block-icon'
import { BlockEnum } from '../../types'

export type PublishedSnippetListItem = SnippetListItem

type SnippetDetailCardProps = {
  snippet: PublishedSnippetListItem
}

const SnippetDetailCard: FC<SnippetDetailCardProps> = ({
  snippet,
}) => {
  const { author, description, icon_info, name } = snippet
  const { data: workflow } = useSnippetPublishedWorkflow(snippet.id)

  const blockTypes = useMemo(() => {
    const graph = workflow?.graph
    if (!graph || typeof graph !== 'object')
      return []

    const graphRecord = graph as Record<string, unknown>
    if (!Array.isArray(graphRecord.nodes))
      return []

    const availableBlockTypes = new Set(Object.values(BlockEnum))

    return graphRecord.nodes.reduce<BlockEnum[]>((result, node) => {
      if (!node || typeof node !== 'object')
        return result

      const nodeRecord = node as Record<string, unknown>
      if (!nodeRecord.data || typeof nodeRecord.data !== 'object')
        return result

      const dataRecord = nodeRecord.data as Record<string, unknown>
      const blockType = dataRecord.type
      if (typeof blockType !== 'string' || !availableBlockTypes.has(blockType as BlockEnum))
        return result

      const normalizedBlockType = blockType as BlockEnum
      if (!result.includes(normalizedBlockType))
        result.push(normalizedBlockType)

      return result
    }, [])
  }, [workflow?.graph])

  return (
    <div className="w-[224px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 pb-4 pt-3 shadow-lg backdrop-blur-[5px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <AppIcon
            size="tiny"
            iconType={icon_info.icon_type}
            icon={icon_info.icon}
            background={icon_info.icon_background}
            imageUrl={icon_info.icon_url}
          />
          <div className="text-text-primary system-md-medium">{name}</div>
        </div>
        {!!description && (
          <div className="w-[200px] text-text-secondary system-xs-regular">
            {description}
          </div>
        )}
        {!!blockTypes.length && (
          <div className="flex items-center gap-0.5 pt-1">
            {blockTypes.map(blockType => (
              <BlockIcon
                key={blockType}
                type={blockType}
                size="sm"
              />
            ))}
          </div>
        )}
      </div>
      {!!author && (
        <div className="pt-3 text-text-tertiary system-xs-regular">
          {author}
        </div>
      )}
    </div>
  )
}

export default SnippetDetailCard
