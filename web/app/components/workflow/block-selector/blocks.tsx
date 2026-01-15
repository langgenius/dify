import type { NodeDefault } from '../types'
import type { BlockClassificationEnum } from './types'
import { groupBy } from 'es-toolkit/compat'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { BLOCK_CLASSIFICATIONS } from './constants'
import { useBlocks } from './hooks'

type BlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum) => void
  availableBlocksTypes?: BlockEnum[]
  blocks?: NodeDefault[]
}
const Blocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  blocks: blocksFromProps,
}: BlocksProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const blocksFromHooks = useBlocks()

  // Use external blocks if provided, otherwise fallback to hook-based blocks
  const blocks = blocksFromProps || blocksFromHooks.map(block => ({
    metaData: {
      classification: block.classification,
      sort: 0, // Default sort order
      type: block.type,
      title: block.title,
      author: 'Dify',
      // @ts-expect-error Fix this missing field later
      description: block.description,
    },
    defaultValue: {},
    checkValid: () => ({ isValid: true }),
  }) as NodeDefault)

  const groups = useMemo(() => {
    return BLOCK_CLASSIFICATIONS.reduce((acc, classification) => {
      const grouped = groupBy(blocks, 'metaData.classification')
      const list = (grouped[classification] || []).filter((block) => {
        // Filter out trigger types from Blocks tab
        if (block.metaData.type === BlockEnum.TriggerWebhook
          || block.metaData.type === BlockEnum.TriggerSchedule
          || block.metaData.type === BlockEnum.TriggerPlugin) {
          return false
        }

        return block.metaData.title.toLowerCase().includes(searchText.toLowerCase()) && availableBlocksTypes.includes(block.metaData.type)
      })

      return {
        ...acc,
        [classification]: list,
      }
    }, {} as Record<string, typeof blocks>)
  }, [blocks, searchText, availableBlocksTypes])
  const isEmpty = Object.values(groups).every(list => !list.length)

  const renderGroup = useCallback((classification: BlockClassificationEnum) => {
    const list = groups[classification].sort((a, b) => (a.metaData.sort || 0) - (b.metaData.sort || 0))
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const hasKnowledgeBaseNode = nodes.some(node => node.data.type === BlockEnum.KnowledgeBase)
    const filteredList = list.filter((block) => {
      if (hasKnowledgeBaseNode)
        return block.metaData.type !== BlockEnum.KnowledgeBase
      return true
    })

    return (
      <div
        key={classification}
        className="mb-1 last-of-type:mb-0"
      >
        {
          classification !== '-' && !!filteredList.length && (
            <div className="flex h-[22px] items-start px-3 text-xs font-medium text-text-tertiary">
              {t(`tabs.${classification}`, { ns: 'workflow' })}
            </div>
          )
        }
        {
          filteredList.map(block => (
            <Tooltip
              key={block.metaData.type}
              position="right"
              popupClassName="w-[200px] rounded-xl"
              needsDelay={false}
              popupContent={(
                <div>
                  <BlockIcon
                    size="md"
                    className="mb-2"
                    type={block.metaData.type}
                  />
                  <div className="system-md-medium mb-1 text-text-primary">{block.metaData.title}</div>
                  <div className="system-xs-regular text-text-tertiary">{block.metaData.description}</div>
                </div>
              )}
            >
              <div
                key={block.metaData.type}
                className="flex h-8 w-full cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover"
                onClick={() => onSelect(block.metaData.type)}
              >
                <BlockIcon
                  className="mr-2 shrink-0"
                  type={block.metaData.type}
                />
                <div className="grow text-sm text-text-secondary">{block.metaData.title}</div>
                {
                  block.metaData.type === BlockEnum.LoopEnd && (
                    <Badge
                      text={t('nodes.loop.loopNode', { ns: 'workflow' })}
                      className="ml-2 shrink-0"
                    />
                  )
                }
              </div>
            </Tooltip>
          ))
        }
      </div>
    )
  }, [groups, onSelect, t, store])

  return (
    <div className="max-h-[480px] max-w-[500px] overflow-y-auto p-1">
      {
        isEmpty && (
          <div className="flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary">{t('tabs.noResult', { ns: 'workflow' })}</div>
        )
      }
      {
        !isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)
      }
    </div>
  )
}

export default memo(Blocks)
