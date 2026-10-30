import type { NodeDefault, OnSelectBlock } from '../types'
import type { BlockClassification } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { groupBy } from 'es-toolkit/compat'
import { Fragment, memo, useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Badge from '@/app/components/base/badge'
import BlockIcon from '../block-icon'
import { useHumanInputMigration } from '../nodes/human-input-v2/migration/context'
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
  disabled: boolean
}

const Blocks = ({
  searchText,
  onSelect,
  availableBlocksTypes = [],
  blocks: blocksFromProps,
}: BlocksProps) => {
  const { t } = useTranslation(['workflow', 'workflowLogic', 'navigation'])
  const store = useStoreApi()
  const migration = useHumanInputMigration()
  const blocksFromHooks = useBlocks()
  const [previewCardHandle] = useState(() => createPreviewCardHandle<BlockPreviewPayload>())
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
            <div className="flex h-5.5 items-start px-3 text-xs font-medium text-text-tertiary">
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
                  payload={{ block, disabled: isHumanInputDisabled }}
                  render={
                    <button
                      type="button"
                      aria-describedby={describedBy || undefined}
                      aria-disabled={isHumanInputDisabled}
                      data-disabled={isHumanInputDisabled || undefined}
                      className="group/block-row flex h-8 w-full cursor-pointer items-center rounded-lg px-3 text-start hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled data-[disabled]:hover:bg-transparent"
                      onClick={() => {
                        if (!isHumanInputDisabled) onSelect(block.metaData.type)
                      }}
                    >
                      <BlockIcon
                        className="me-2 shrink-0 group-data-disabled/block-row:opacity-30"
                        type={block.metaData.type}
                      />
                      <span className="min-w-0 grow truncate text-sm text-text-secondary group-data-disabled/block-row:opacity-30">
                        {block.metaData.title}
                      </span>
                      {isHumanInputDisabled && (
                        <Badge
                          text={t(($) => $['nodes.humanInputMigration.disabledBadge'], {
                            ns: 'workflow',
                          })}
                          size="xs"
                          className="ms-2 shrink-0 px-1.25 py-0.75"
                        />
                      )}
                      {block.metaData.type === BlockEnum.KnowledgeRetrievalV2 && (
                        <Badge
                          size="xs"
                          variant="dimm"
                          text={t(($) => $['menus.status'], { ns: 'navigation' })}
                          className="ms-2 shrink-0"
                        />
                      )}
                      {block.metaData.type === BlockEnum.LoopEnd && (
                        <Badge
                          text={t(($) => $['nodes.loop.loopNode'], { ns: 'workflowLogic' })}
                          className="ms-2 shrink-0"
                        />
                      )}
                    </button>
                  }
                />
                {isHumanInputDisabled && migration?.canEdit && (
                  <Button
                    className="my-1 ms-3"
                    size="small"
                    loading={migration.pending}
                    onClick={migration.openMigrationDialog}
                  >
                    {t(($) => $['nodes.humanInputMigration.action.migrateNow'], { ns: 'workflow' })}
                  </Button>
                )}
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
    [groups, onSelect, previewCardHandle, previewDescriptionBaseId, t, store, migration],
  )

  return (
    <div className="max-h-120 max-w-125 overflow-y-auto p-1">
      {isEmpty && (
        <div className="flex h-5.5 items-center px-3 text-xs font-medium text-text-tertiary">
          {t(($) => $['tabs.noResult'], { ns: 'workflow' })}
        </div>
      )}
      {!isEmpty && BLOCK_CLASSIFICATIONS.map(renderGroup)}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => <BlockPreviewCard payload={payload} />}
      </PreviewCard>
    </div>
  )
}

type BlockPreviewCardProps = {
  payload?: BlockPreviewPayload
}

function BlockPreviewCard({ payload }: BlockPreviewCardProps) {
  const { t } = useTranslation(['workflow'])
  if (!payload) return null

  const { block, disabled } = payload

  if (disabled) {
    return (
      <BlockSelectorPreviewCardContent>
        <div className="-mx-2 -my-1.5 flex flex-col gap-1">
          <div className="p-2">
            <div className="flex items-center gap-2">
              <BlockIcon size="md" className="shrink-0" type={block.metaData.type} />
              <div className="system-md-medium text-text-primary">{block.metaData.title}</div>
            </div>
            <div className="mt-2 system-xs-regular wrap-break-word text-text-tertiary">
              {block.metaData.description}
            </div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['nodes.humanInputMigration.preview.author'], { ns: 'workflow' })}
            </div>
          </div>
          <div className="rounded-lg bg-background-section p-2">
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 i-ri-loader-2-line size-4 shrink-0 text-text-tertiary"
              />
              <div className="system-xs-regular text-text-secondary">
                {t(($) => $['nodes.humanInputMigration.preview.description'], { ns: 'workflow' })}
              </div>
            </div>
          </div>
        </div>
      </BlockSelectorPreviewCardContent>
    )
  }

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
