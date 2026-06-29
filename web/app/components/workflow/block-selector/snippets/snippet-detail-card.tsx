import type { FC } from 'react'
import type { SnippetListItem } from '@/types/snippet'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import { useMembers } from '@/service/use-common'
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
  const { description, name } = snippet
  const { t } = useTranslation('snippet')
  const { data: membersData } = useMembers()
  const { data: workflow } = useSnippetPublishedWorkflow(snippet.id)

  const creatorName = useMemo(() => {
    const member = membersData?.accounts?.find(member => member.id === snippet.created_by)
    return member?.name || t('unknownUser')
  }, [membersData?.accounts, snippet.created_by, t])

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
    <div className="w-56 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 pt-3 pb-4 shadow-lg backdrop-blur-[5px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <div className="system-md-medium text-text-primary">{name}</div>
        </div>
        {!!description && (
          <div className="w-50 system-xs-regular text-text-secondary">
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
      <div className="pt-3 system-xs-regular text-text-tertiary">
        {creatorName}
      </div>
    </div>
  )
}

export default SnippetDetailCard
