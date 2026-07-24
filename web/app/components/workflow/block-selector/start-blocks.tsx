import type { BlockEnum, CommonNodeType } from '../types'
import type { TriggerDefaultValue } from './types'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { useAvailableNodesMetaData } from '../../workflow-app/hooks'
import BlockIcon from '../block-icon'
import { BlockEnum as BlockEnumValues } from '../types'
// import { useNodeMetaData } from '../hooks'
import { START_BLOCKS } from './constants'

type StartBlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, triggerDefaultValue?: TriggerDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  onContentStateChange?: (hasContent: boolean) => void
  hideUserInput?: boolean
}

const StartBlocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  onContentStateChange,
  hideUserInput = false, // Allow parent to explicitly hide Start node option (e.g. when one already exists).
}: StartBlocksProps) => {
  const { t } = useTranslation()
  const nodes = useNodes()
  // const nodeMetaData = useNodeMetaData()
  const availableNodesMetaData = useAvailableNodesMetaData()

  const filteredBlocks = useMemo(() => {
    // Check if Start node already exists in workflow
    const hasStartNode = nodes.some(node => (node.data as CommonNodeType)?.type === BlockEnumValues.Start)
    const normalizedSearch = searchText.toLowerCase()
    const getDisplayName = (blockType: BlockEnum) => {
      if (blockType === BlockEnumValues.TriggerWebhook)
        return t('customWebhook', { ns: 'workflow' })

      return t(`blocks.${blockType}`, { ns: 'workflow' })
    }

    return START_BLOCKS.filter((block) => {
      // Hide User Input (Start) if it already exists in workflow or if hideUserInput is true
      if (block.type === BlockEnumValues.Start && (hasStartNode || hideUserInput))
        return false

      // Filter by search text
      const displayName = getDisplayName(block.type).toLowerCase()
      if (!displayName.includes(normalizedSearch) && !block.title.toLowerCase().includes(normalizedSearch))
        return false

      // availableBlocksTypes now contains properly filtered entry node types from parent
      return availableBlocksTypes.includes(block.type)
    })
  }, [searchText, availableBlocksTypes, nodes, t, hideUserInput])

  const isEmpty = filteredBlocks.length === 0

  useEffect(() => {
    onContentStateChange?.(!isEmpty)
  }, [isEmpty, onContentStateChange])

  const renderBlock = useCallback((block: typeof START_BLOCKS[number]) => (
    <Tooltip
      key={block.type}
      position="right"
      popupClassName="w-[224px] rounded-xl"
      needsDelay={false}
      popupContent={(
        <div>
          <BlockIcon
            size="md"
            className="mb-2"
            type={block.type}
          />
          <div className="system-md-medium mb-1 text-text-primary">
            {block.type === BlockEnumValues.TriggerWebhook
              ? t('customWebhook', { ns: 'workflow' })
              : t(`blocks.${block.type}`, { ns: 'workflow' })}
          </div>
          <div className="system-xs-regular text-text-secondary">
            {t(`blocksAbout.${block.type}`, { ns: 'workflow' })}
          </div>
          {(block.type === BlockEnumValues.TriggerWebhook || block.type === BlockEnumValues.TriggerSchedule) && (
            <div className="system-xs-regular mb-1 mt-1 text-text-tertiary">
              {t('author', { ns: 'tools' })}
              {' '}
              {t('difyTeam', { ns: 'workflow' })}
            </div>
          )}
        </div>
      )}
    >
      <div
        className="flex h-8 w-full cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover"
        onClick={() => onSelect(block.type)}
      >
        <BlockIcon
          className="mr-2 shrink-0"
          type={block.type}
        />
        <div className="flex w-0 grow items-center justify-between text-sm text-text-secondary">
          <span className="truncate">{t(`blocks.${block.type}`, { ns: 'workflow' })}</span>
          {block.type === BlockEnumValues.Start && (
            <span className="system-xs-regular ml-2 shrink-0 text-text-quaternary">{t('blocks.originalStartNode', { ns: 'workflow' })}</span>
          )}
        </div>
      </div>
    </Tooltip>
  ), [availableNodesMetaData, onSelect, t])

  if (isEmpty)
    return null

  return (
    <div className="p-1">
      <div className="mb-1">
        {filteredBlocks.map((block, index) => (
          <div key={block.type}>
            {renderBlock(block)}
            {block.type === BlockEnumValues.Start && index < filteredBlocks.length - 1 && (
              <div className="my-1 px-3">
                <div className="border-t border-divider-subtle" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(StartBlocks)
