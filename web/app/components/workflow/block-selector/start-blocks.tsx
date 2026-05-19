import type { BlockEnum, CommonNodeType } from '../types'
import type { TriggerDefaultValue } from './types'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
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
type StartBlockPreviewPayload = {
  block: typeof START_BLOCKS[number]
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
  const previewCardHandle = useMemo(() => createPreviewCardHandle<StartBlockPreviewPayload>(), [])
  // const nodeMetaData = useNodeMetaData()

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

  // Preview is supplementary: the block icon, title and description all become
  // reachable from the inspector + canvas once the row is clicked to insert
  // the start node, so hover/focus-only activation is a11y-safe. See
  // packages/dify-ui/AGENTS.md → Overlay Primitive Selection.
  const renderBlock = useCallback((block: typeof START_BLOCKS[number]) => (
    <PreviewCardTrigger
      key={block.type}
      delay={150}
      closeDelay={150}
      handle={previewCardHandle}
      payload={{ block }}
      render={(
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
              <span className="ml-2 shrink-0 system-xs-regular text-text-quaternary">{t('blocks.originalStartNode', { ns: 'workflow' })}</span>
            )}
          </div>
        </div>
      )}
    />
  ), [onSelect, previewCardHandle, t])

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
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <StartBlockPreviewCard
            payload={payload as StartBlockPreviewPayload | undefined}
            t={t}
          />
        )}
      </PreviewCard>
    </div>
  )
}

type StartBlockPreviewCardProps = {
  payload?: StartBlockPreviewPayload
  t: ReturnType<typeof useTranslation>['t']
}

function StartBlockPreviewCard({
  payload,
  t,
}: StartBlockPreviewCardProps) {
  if (!payload)
    return null

  const { block } = payload

  return (
    <PreviewCardContent placement="right" popupClassName="w-[224px] px-3 py-2.5">
      <div>
        <BlockIcon
          size="md"
          className="mb-2"
          type={block.type}
        />
        <div className="mb-1 system-md-medium text-text-primary">
          {block.type === BlockEnumValues.TriggerWebhook
            ? t('customWebhook', { ns: 'workflow' })
            : t(`blocks.${block.type}`, { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular wrap-break-word text-text-secondary">
          {t(`blocksAbout.${block.type}`, { ns: 'workflow' })}
        </div>
        {(block.type === BlockEnumValues.TriggerWebhook || block.type === BlockEnumValues.TriggerSchedule) && (
          <div className="mt-1 mb-1 system-xs-regular text-text-tertiary">
            {t('author', { ns: 'tools' })}
            {' '}
            {t('difyTeam', { ns: 'workflow' })}
          </div>
        )}
      </div>
    </PreviewCardContent>
  )
}

export default memo(StartBlocks)
