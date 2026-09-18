import type { MouseEvent } from 'react'
import type { BlockSelectorProps } from '../../../block-selector'
import type { BlockDefaultValue } from '../../../block-selector/types'
import type { Node } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position } from 'reactflow'
import BlockSelector from '../../../block-selector'
import { useAvailableBlocks } from '../../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../../hooks/use-nodes-interactions'
import { useIsChatMode, useNodesReadOnly } from '../../../hooks/use-workflow'
import { useStore, useWorkflowStore } from '../../../store'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import { getNodeCatalogType } from '../../../utils'
import { ErrorHandleTypeEnum } from './error-handle/types'

type NodeHandleProps = {
  handleId: string
  handleClassName?: string
  nodeSelectorClassName?: string
  showExceptionStatus?: boolean
} & Pick<Node, 'id' | 'data'>

// React Flow measures the 16px handle box. Enlarge its hit area with ::before
// and scale the button independently so zoom compensation cannot move edge endpoints.

const canAutoOpenStartNodeSelector = (nodeType: BlockEnum, isChatMode: boolean) => {
  if (isChatMode) return false

  return (
    nodeType === BlockEnum.Start ||
    nodeType === BlockEnum.TriggerSchedule ||
    nodeType === BlockEnum.TriggerWebhook ||
    nodeType === BlockEnum.TriggerPlugin
  )
}

export const NodeTargetHandle = memo(
  ({ id, data, handleId, handleClassName, nodeSelectorClassName }: NodeHandleProps) => {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const preserveOutsideFocusRef = useRef(false)
    const { handleNodeAdd } = useNodesInteractions()
    const { getNodesReadOnly } = useNodesReadOnly()
    const connected = data._connectedTargetHandleIds?.includes(handleId)
    const { availablePrevBlocks } = useAvailableBlocks(
      getNodeCatalogType(data),
      data.isInIteration || data.isInLoop,
    )
    const isConnectable = !!availablePrevBlocks.length

    const handleOpenChange = useCallback<NonNullable<BlockSelectorProps['onOpenChange']>>(
      (v, details) => {
        preserveOutsideFocusRef.current =
          details?.reason === 'outside-press' || details?.reason === 'focus-out'
        setOpen(v)
      },
      [],
    )
    const handleHandleClick = useCallback(
      (e: MouseEvent) => {
        e.stopPropagation()
        preserveOutsideFocusRef.current = false
        if (!connected) setOpen((v) => !v)
      },
      [connected],
    )
    const handleSelect = useCallback(
      (type: BlockEnum, pluginDefaultValue?: BlockDefaultValue) => {
        handleNodeAdd(
          {
            nodeType: type,
            pluginDefaultValue,
          },
          {
            nextNodeId: id,
            nextNodeTargetHandle: handleId,
          },
        )
      },
      [handleNodeAdd, id, handleId],
    )

    return (
      <>
        <Handle
          id={handleId}
          type="target"
          position={Position.Left}
          className={cn(
            'z-1 size-4! rounded-none! border-none! bg-transparent! outline-hidden!',
            'before:absolute before:-inset-1 before:scale-[var(--workflow-control-scale,1)]',
            'after:absolute after:top-1 after:left-1.5 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
            data._runningStatus === NodeRunningStatus.Succeeded &&
              'after:bg-workflow-link-line-success-handle',
            data._runningStatus === NodeRunningStatus.Failed &&
              'after:bg-workflow-link-line-error-handle',
            data._runningStatus === NodeRunningStatus.Exception &&
              'after:bg-workflow-link-line-failure-handle',
            !connected && 'after:opacity-0',
            (data.type === BlockEnum.Start ||
              data.type === BlockEnum.TriggerWebhook ||
              data.type === BlockEnum.TriggerSchedule ||
              data.type === BlockEnum.TriggerPlugin) &&
              'opacity-0',
            handleClassName,
          )}
          isConnectable={isConnectable}
          onClick={handleHandleClick}
        >
          {!connected && isConnectable && !getNodesReadOnly() && (
            <BlockSelector
              triggerRef={triggerRef}
              finalFocus={() => (preserveOutsideFocusRef.current ? false : triggerRef.current)}
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={handleSelect}
              snippetInsertPayload={{
                nextNodeId: id,
                nextNodeTargetHandle: handleId,
              }}
              triggerStyle={{ scale: 'var(--workflow-control-scale, 1)' }}
              placement="left"
              showStartTab
              triggerClassName={`
                absolute -left-1 -top-1 opacity-0 pointer-events-none transition-opacity duration-150
                ${nodeSelectorClassName}
                group-hover:opacity-100 focus:opacity-100
                ${data.selected && 'opacity-100'}
                data-popup-open:opacity-100
              `}
              availableBlocksTypes={availablePrevBlocks}
            />
          )}
        </Handle>
      </>
    )
  },
)
NodeTargetHandle.displayName = 'NodeTargetHandle'

export const NodeSourceHandle = memo(
  ({
    id,
    data,
    handleId,
    handleClassName,
    nodeSelectorClassName,
    showExceptionStatus,
  }: NodeHandleProps) => {
    const { t } = useTranslation()
    const shouldAutoOpenStartNodeSelector = useStore((s) => s.shouldAutoOpenStartNodeSelector)
    const setShouldAutoOpenStartNodeSelector = useStore((s) => s.setShouldAutoOpenStartNodeSelector)
    const setHasSelectedStartNode = useStore((s) => s.setHasSelectedStartNode)
    const workflowStoreApi = useWorkflowStore()
    const { handleNodeAdd } = useNodesInteractions()
    const { getNodesReadOnly } = useNodesReadOnly()
    const { availableNextBlocks } = useAvailableBlocks(
      getNodeCatalogType(data),
      data.isInIteration || data.isInLoop,
    )
    const isConnectable = !!availableNextBlocks.length
    const isChatMode = useIsChatMode()
    const shouldAutoOpen =
      shouldAutoOpenStartNodeSelector && canAutoOpenStartNodeSelector(data.type, isChatMode)
    const [open, setOpen] = useState(() => shouldAutoOpen)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const preserveOutsideFocusRef = useRef(false)
    // Auto-open keeps the previous focus; a pointer click on the handle returns to its button.
    const openedFromHandleRef = useRef(false)

    const connected = data._connectedSourceHandleIds?.includes(handleId)
    // Branch ports can be only 24px apart in canvas coordinates. Keep their
    // buttons and hit areas in that coordinate space so zooming out cannot make
    // one branch intercept another's click or connection drag.
    const hasMultipleSourceHandles =
      data.type === BlockEnum.IfElse ||
      data.type === BlockEnum.QuestionClassifier ||
      data.type === BlockEnum.HumanInput ||
      data.error_strategy === ErrorHandleTypeEnum.failBranch
    const handleOpenChange = useCallback<NonNullable<BlockSelectorProps['onOpenChange']>>(
      (v, details) => {
        preserveOutsideFocusRef.current =
          details?.reason === 'outside-press' || details?.reason === 'focus-out'
        setOpen(v)
      },
      [],
    )
    const handleHandleClick = useCallback((e: MouseEvent) => {
      e.stopPropagation()
      preserveOutsideFocusRef.current = false
      openedFromHandleRef.current = true
      setOpen((v) => !v)
    }, [])
    const handleSelect = useCallback(
      (type: BlockEnum, pluginDefaultValue?: BlockDefaultValue) => {
        handleNodeAdd(
          {
            nodeType: type,
            pluginDefaultValue,
          },
          {
            prevNodeId: id,
            prevNodeSourceHandle: handleId,
          },
        )
      },
      [handleNodeAdd, id, handleId],
    )

    useEffect(() => {
      if (!shouldAutoOpenStartNodeSelector) return

      if (isChatMode) {
        setShouldAutoOpenStartNodeSelector?.(false)
        return
      }

      if (canAutoOpenStartNodeSelector(data.type, false)) {
        if (setShouldAutoOpenStartNodeSelector) setShouldAutoOpenStartNodeSelector(false)
        else workflowStoreApi?.setState?.({ shouldAutoOpenStartNodeSelector: false })

        if (setHasSelectedStartNode) setHasSelectedStartNode(false)
        else workflowStoreApi?.setState?.({ hasSelectedStartNode: false })
      }
    }, [
      shouldAutoOpenStartNodeSelector,
      data.type,
      isChatMode,
      setShouldAutoOpenStartNodeSelector,
      setHasSelectedStartNode,
      workflowStoreApi,
    ])

    return (
      <Handle
        id={handleId}
        type="source"
        position={Position.Right}
        className={cn(
          'group/handle z-1 size-4! rounded-none! border-none! bg-transparent! outline-hidden!',
          'before:absolute before:-inset-1',
          !hasMultipleSourceHandles && 'before:scale-[var(--workflow-control-scale,1)]',
          'after:absolute after:top-1 after:right-1.5 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
          data._runningStatus === NodeRunningStatus.Succeeded &&
            'after:bg-workflow-link-line-success-handle',
          data._runningStatus === NodeRunningStatus.Failed &&
            'after:bg-workflow-link-line-error-handle',
          showExceptionStatus &&
            data._runningStatus === NodeRunningStatus.Exception &&
            'after:bg-workflow-link-line-failure-handle',
          !connected && 'after:opacity-0',
          handleClassName,
        )}
        isConnectable={isConnectable}
        onClick={handleHandleClick}
      >
        <div className="absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg group-hover/handle:block">
          <div className="system-xs-regular text-text-tertiary">
            <div className="whitespace-nowrap">
              <span className="system-xs-medium text-text-secondary">
                {t(($) => $['common.parallelTip.click.title'], { ns: 'workflow' })}
              </span>
              {t(($) => $['common.parallelTip.click.desc'], { ns: 'workflow' })}
            </div>
            <div>
              <span className="system-xs-medium text-text-secondary">
                {t(($) => $['common.parallelTip.drag.title'], { ns: 'workflow' })}
              </span>
              {t(($) => $['common.parallelTip.drag.desc'], { ns: 'workflow' })}
            </div>
          </div>
        </div>
        {isConnectable && !getNodesReadOnly() && (
          <BlockSelector
            triggerRef={triggerRef}
            finalFocus={() => {
              if (preserveOutsideFocusRef.current) return false
              return openedFromHandleRef.current ? triggerRef.current : true
            }}
            open={open}
            onOpenChange={handleOpenChange}
            onSelect={handleSelect}
            snippetInsertPayload={{
              prevNodeId: id,
              prevNodeSourceHandle: handleId,
            }}
            triggerClassName={`
              absolute -top-1 -left-1 opacity-0 pointer-events-none transition-opacity duration-150
              ${nodeSelectorClassName}
              group-hover:opacity-100 focus:opacity-100
              ${data.selected && 'opacity-100'}
              data-popup-open:opacity-100
            `}
            availableBlocksTypes={availableNextBlocks}
            triggerStyle={{
              scale: hasMultipleSourceHandles ? '1' : 'var(--workflow-control-scale, 1)',
            }}
            showStartTab
          />
        )}
      </Handle>
    )
  },
)
NodeSourceHandle.displayName = 'NodeSourceHandle'
