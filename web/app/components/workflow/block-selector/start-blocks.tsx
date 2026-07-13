import type { BlockEnum, CommonNodeType } from '../types'
import type { TriggerDefaultValue } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import BlockIcon from '../block-icon'
import { BlockEnum as BlockEnumValues } from '../types'
import { BlockSelectorRow } from './block-selector-row'
// import { useNodeMetaData } from '../hooks'
import { START_BLOCKS } from './constants'

type StartBlocksProps = {
  searchText: string
  onSelect: (type: BlockEnum, triggerDefaultValue?: TriggerDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  onContentStateChange?: (hasContent: boolean) => void
  hideUserInput?: boolean
  showMostCommonBadge?: boolean
  showUserInputAdded?: boolean
  showUserInputDisabled?: boolean
  disabled?: boolean
}
type StartBlockPreviewPayload = {
  block: (typeof START_BLOCKS)[number]
}

const StartBlocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  onContentStateChange,
  hideUserInput = false, // Allow parent to explicitly hide Start node option (e.g. when one already exists).
  showMostCommonBadge = false,
  showUserInputAdded = false,
  showUserInputDisabled = false,
  disabled = false,
}: StartBlocksProps) => {
  const { t } = useTranslation()
  const nodes = useNodes()
  const previewCardHandle = useMemo(() => createPreviewCardHandle<StartBlockPreviewPayload>(), [])
  // const nodeMetaData = useNodeMetaData()

  const filteredBlocks = useMemo(() => {
    // Check if Start node already exists in workflow
    const hasStartNode = nodes.some(
      (node) => (node.data as CommonNodeType)?.type === BlockEnumValues.Start,
    )
    const normalizedSearch = searchText.toLowerCase()
    const getDisplayName = (blockType: BlockEnum) => {
      if (blockType === BlockEnumValues.TriggerWebhook)
        return t(($) => $.customWebhook, { ns: 'workflow' })

      return t(($) => $[`blocks.${blockType}`], { ns: 'workflow' })
    }

    return START_BLOCKS.filter((block) => {
      // Hide User Input (Start) if it already exists in workflow or if hideUserInput is true.
      // In read-only conflict modes, keep it visible so the row can show Added or disabled tooltip state.
      if (
        block.type === BlockEnumValues.Start &&
        (hasStartNode || hideUserInput) &&
        !showUserInputAdded &&
        !showUserInputDisabled
      )
        return false

      // Filter by search text
      const displayName = getDisplayName(block.type).toLowerCase()
      if (
        !displayName.includes(normalizedSearch) &&
        !block.title.toLowerCase().includes(normalizedSearch)
      )
        return false

      // availableBlocksTypes now contains properly filtered entry node types from parent
      return availableBlocksTypes.includes(block.type)
    })
  }, [
    searchText,
    availableBlocksTypes,
    nodes,
    t,
    hideUserInput,
    showUserInputAdded,
    showUserInputDisabled,
  ])

  const isEmpty = filteredBlocks.length === 0

  useEffect(() => {
    onContentStateChange?.(!isEmpty)
  }, [isEmpty, onContentStateChange])

  // Preview is supplementary: the block icon, title and description all become
  // reachable from the inspector + canvas once the row is clicked to insert
  // the start node, so hover/focus-only activation is a11y-safe. See
  // packages/dify-ui/AGENTS.md → Overlay Primitive Selection.
  const renderBlock = useCallback(
    (block: (typeof START_BLOCKS)[number]) => {
      const isUserInput = block.type === BlockEnumValues.Start
      const isUserInputDisabled = isUserInput && showUserInputDisabled
      const isRowDisabled = disabled || (isUserInput && showUserInputAdded) || isUserInputDisabled
      const label = t(($) => $[`blocks.${block.type}`], { ns: 'workflow' })
      const disabledReason = t(($) => $['nodes.startPlaceholder.userInputConflictTip'], {
        ns: 'workflow',
      })
      const row = (
        <BlockSelectorRow
          aria-disabled={isRowDisabled}
          aria-label={isUserInputDisabled ? `${label}. ${disabledReason}` : label}
          disabled={isRowDisabled}
          onClick={() => {
            if (isRowDisabled) return
            onSelect(block.type)
          }}
        >
          <div
            className={cn('flex min-w-0 flex-1 items-center', isUserInputDisabled && 'opacity-30')}
          >
            <BlockIcon className="mr-2 shrink-0" type={block.type} size="sm" />
            <div className="flex w-0 grow items-center justify-between text-sm text-text-secondary">
              <span className="truncate system-sm-medium">{label}</span>
              {isUserInput && showUserInputAdded && (
                <span className="ml-2 shrink-0 system-xs-regular text-text-tertiary">
                  {t(($) => $['operation.added'], { ns: 'common' })}
                </span>
              )}
              {isUserInput && showMostCommonBadge && !showUserInputAdded && (
                <span className="ml-2 shrink-0 rounded-[5px] border border-divider-deep px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['blocks.mostCommon'], { ns: 'workflow' })}
                </span>
              )}
              {isUserInput &&
                !showMostCommonBadge &&
                !showUserInputAdded &&
                !showUserInputDisabled && (
                  <span className="ml-2 shrink-0 system-xs-regular text-text-quaternary">
                    {t(($) => $['blocks.originalStartNode'], { ns: 'workflow' })}
                  </span>
                )}
            </div>
          </div>
        </BlockSelectorRow>
      )

      if (isUserInputDisabled) {
        return (
          <Tooltip key={block.type}>
            <TooltipTrigger render={row} />
            <TooltipContent
              placement="right"
              sideOffset={8}
              className="max-w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg"
            >
              <p className="system-xs-regular text-text-secondary">{disabledReason}</p>
            </TooltipContent>
          </Tooltip>
        )
      }

      return (
        <PreviewCardTrigger
          key={block.type}
          delay={150}
          closeDelay={150}
          handle={previewCardHandle}
          payload={{ block }}
          render={row}
        />
      )
    },
    [
      disabled,
      onSelect,
      previewCardHandle,
      showMostCommonBadge,
      showUserInputAdded,
      showUserInputDisabled,
      t,
    ],
  )

  if (isEmpty) return null

  return (
    <div className="p-1">
      <div>
        {filteredBlocks.map((block, index) => (
          <div key={block.type}>
            {renderBlock(block)}
            {block.type === BlockEnumValues.Start &&
              !showMostCommonBadge &&
              index < filteredBlocks.length - 1 && (
                <div className="my-1 px-3">
                  <div className="border-t border-divider-subtle" />
                </div>
              )}
          </div>
        ))}
      </div>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <StartBlockPreviewCard payload={payload as StartBlockPreviewPayload | undefined} t={t} />
        )}
      </PreviewCard>
    </div>
  )
}

type StartBlockPreviewCardProps = {
  payload?: StartBlockPreviewPayload
  t: ReturnType<typeof useTranslation>['t']
}

function StartBlockPreviewCard({ payload, t }: StartBlockPreviewCardProps) {
  if (!payload) return null

  const { block } = payload
  const description =
    block.type === BlockEnumValues.Start
      ? t(($) => $['nodes.start.userInputTipDescription'], { ns: 'workflow' })
      : t(($) => $[`blocksAbout.${block.type}`], { ns: 'workflow' })
  const showDifyTeamAuthor = [
    BlockEnumValues.Start,
    BlockEnumValues.TriggerWebhook,
    BlockEnumValues.TriggerSchedule,
  ].includes(block.type)

  return (
    <PreviewCardContent placement="right" popupClassName="w-[224px] px-3 pt-3 pb-2.5">
      <div>
        <BlockIcon size="md" className="mb-2" type={block.type} />
        <div className="mb-1 system-md-medium text-text-primary">
          {t(($) => $[`blocks.${block.type}`], { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular wrap-break-word text-text-secondary">{description}</div>
        {showDifyTeamAuthor && (
          <div className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $.author, { ns: 'tools' })} {t(($) => $.difyTeam, { ns: 'workflow' })}
          </div>
        )}
      </div>
    </PreviewCardContent>
  )
}

export default memo(StartBlocks)
