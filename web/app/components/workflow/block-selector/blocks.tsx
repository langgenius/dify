import type { NodeDefault, OnSelectBlock } from '../types'
import type { BlockClassification } from './types'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { groupBy } from 'es-toolkit/compat'
import { Fragment, memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Badge from '@/app/components/base/badge'
import BlockIcon from '../block-icon'
import { getHumanInputCreationPolicy } from '../nodes/human-input-v2/migration/policy'
import { BlockEnum } from '../types'
import { AgentBlockItem } from './agent-selector'
import { BLOCK_CLASSIFICATIONS } from './constants'
import { useBlocks } from './hooks'
import { BlockSelectorPreviewCardContent } from './preview-card'

type BlocksProps = {
  searchText: string
  onSelect: OnSelectBlock
  availableBlocksTypes?: BlockEnum[]
  blocks?: NodeDefault[]
}
type BlockPreviewPayload = {
  block: NodeDefault
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
  const previewCardHandle = useMemo(() => createPreviewCardHandle<BlockPreviewPayload>(), [])
  const previewDescriptionBaseId = useId()

  // Use external blocks if provided, otherwise fallback to hook-based blocks
  const blocks =
    blocksFromProps ||
    blocksFromHooks.map(
      (block) =>
        ({
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
        }) as NodeDefault,
    )

  const groups = useMemo(() => {
    return BLOCK_CLASSIFICATIONS.reduce(
      (acc, classification) => {
        const grouped = groupBy(blocks, 'metaData.classification')
        const list = (grouped[classification] || []).filter((block) => {
          // Filter out trigger types from Blocks tab
          if (
            block.metaData.type === BlockEnum.TriggerWebhook ||
            block.metaData.type === BlockEnum.TriggerSchedule ||
            block.metaData.type === BlockEnum.TriggerPlugin
          ) {
            return false
          }

          return (
            block.metaData.title.toLowerCase().includes(searchText.toLowerCase()) &&
            availableBlocksTypes.includes(block.metaData.type)
          )
        })

        return {
          ...acc,
          [classification]: list,
        }
      },
      {} as Record<string, typeof blocks>,
    )
  }, [blocks, availableBlocksTypes, searchText])
  const isEmpty = Object.values(groups).every((list) => !list.length)

  const renderGroup = useCallback(
    (classification: BlockClassification) => {
      const list = [...groups[classification]!].sort((a, b) => {
        if (a.metaData.type === BlockEnum.AgentV2) return -1
        if (b.metaData.type === BlockEnum.AgentV2) return 1
        return (a.metaData.sort || 0) - (b.metaData.sort || 0)
      })
      const { getNodes } = store.getState()
      const nodes = getNodes()
      const humanInputPolicy = getHumanInputCreationPolicy(nodes, true)
      const hasKnowledgeBaseNode = nodes.some((node) => node.data.type === BlockEnum.KnowledgeBase)
      const filteredList = list.filter((block) => {
        if (hasKnowledgeBaseNode) return block.metaData.type !== BlockEnum.KnowledgeBase
        return true
      })

      return (
        <div key={classification} className="mb-1 last-of-type:mb-0">
          {classification !== '-' && !!filteredList.length && (
            <div className="flex h-[22px] items-start px-3 text-xs font-medium text-text-tertiary">
              {t(($) => $[`tabs.${classification}`], { ns: 'workflow' })}
            </div>
          )}
          {filteredList.map((block) => {
            if (block.metaData.type === BlockEnum.AgentV2) {
              return (
                <AgentBlockItem
                  key={block.metaData.type}
                  block={block}
                  onSelect={(agent) =>
                    onSelect(BlockEnum.AgentV2, {
                      agent_binding: {
                        binding_type: 'roster_agent',
                        agent_id: agent.id,
                      },
                      agent_node_kind: 'dify_agent',
                      version: '2',
                    })
                  }
                  onStartFromScratch={() =>
                    onSelect(BlockEnum.AgentV2, {
                      agent_binding: {
                        binding_type: 'inline_agent',
                      },
                      agent_node_kind: 'dify_agent',
                      version: '2',
                    })
                  }
                />
              )
            }

            const previewDescriptionId = block.metaData.description
              ? `${previewDescriptionBaseId}-${block.metaData.type}`
              : undefined
            const isHumanInputDisabled =
              block.metaData.type === BlockEnum.HumanInputV2 && humanInputPolicy.hasLegacyHumanInput
            const disabledReasonId = isHumanInputDisabled
              ? `${previewDescriptionBaseId}-${block.metaData.type}-disabled`
              : undefined
            const describedBy = [previewDescriptionId, disabledReasonId].filter(Boolean).join(' ')

            return (
              <Fragment key={block.metaData.type}>
                <PreviewCardTrigger
                  delay={150}
                  closeDelay={150}
                  handle={previewCardHandle}
                  payload={{ block }}
                  render={
                    <button
                      type="button"
                      aria-label={block.metaData.title}
                      aria-describedby={describedBy || undefined}
                      disabled={isHumanInputDisabled}
                      className="flex h-8 w-full cursor-pointer items-center rounded-lg px-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent"
                      onClick={() => onSelect(block.metaData.type)}
                    >
                      <BlockIcon className="mr-2 shrink-0" type={block.metaData.type} />
                      <span className="min-w-0 grow truncate text-sm text-text-secondary">
                        {block.metaData.title}
                      </span>
                      {isHumanInputDisabled && (
                        <Badge
                          text={t(($) => $['nodes.humanInputMigration.disabledBadge'], {
                            ns: 'workflow',
                          })}
                          className="ml-2 shrink-0"
                        />
                      )}
                      {block.metaData.type === BlockEnum.LoopEnd && (
                        <Badge
                          text={t(($) => $['nodes.loop.loopNode'], { ns: 'workflow' })}
                          className="ml-2 shrink-0"
                        />
                      )}
                    </button>
                  }
                />
                {previewDescriptionId && (
                  <span id={previewDescriptionId} className="sr-only">
                    {block.metaData.description}
                  </span>
                )}
                {disabledReasonId && (
                  <span id={disabledReasonId} className="sr-only">
                    {t(($) => $['nodes.humanInputMigration.disabledReason'], { ns: 'workflow' })}
                  </span>
                )}
              </Fragment>
            )
          })}
        </div>
      )
    },
    [groups, onSelect, previewCardHandle, previewDescriptionBaseId, t, store],
  )

  return (
    <div className="max-h-[480px] max-w-[500px] overflow-y-auto p-1">
      {isEmpty && (
        <div className="flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary">
          {t(($) => $['tabs.noResult'], { ns: 'workflow' })}
        </div>
      )}
      {!isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => <BlockPreviewCard payload={payload as BlockPreviewPayload | undefined} />}
      </PreviewCard>
    </div>
  )
}

type BlockPreviewCardProps = {
  payload?: BlockPreviewPayload
}

function BlockPreviewCard({ payload }: BlockPreviewCardProps) {
  if (!payload) return null

  const { block } = payload

  return (
    <BlockSelectorPreviewCardContent>
      <BlockIcon size="md" className="mb-2" type={block.metaData.type} />
      <div className="mb-1 system-md-medium text-text-primary">{block.metaData.title}</div>
      <div className="system-xs-regular wrap-break-word text-text-tertiary">
        {block.metaData.description}
      </div>
    </BlockSelectorPreviewCardContent>
  )
}

export default memo(Blocks)
