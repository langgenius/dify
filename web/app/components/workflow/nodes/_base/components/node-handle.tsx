import type { MouseEvent } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  Handle,
  Position,
} from 'reactflow'
import { useTranslation } from 'react-i18next'
import {
  BlockEnum,
  NodeRunningStatus,
} from '../../../types'
import type { Node } from '../../../types'
import BlockSelector from '../../../block-selector'
import type { DataSourceDefaultValue, ToolDefaultValue } from '../../../block-selector/types'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodesInteractions,
  useNodesReadOnly,
} from '../../../hooks'
import {
  useStore,
} from '../../../store'
import cn from '@/utils/classnames'

type NodeHandleProps = {
  handleId: string
  handleClassName?: string
  nodeSelectorClassName?: string
  showExceptionStatus?: boolean
} & Pick<Node, 'id' | 'data'>

export const NodeTargetHandle = memo(({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeHandleProps) => {
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { getNodesReadOnly } = useNodesReadOnly()
  const connected = data._connectedTargetHandleIds?.includes(handleId)
  const { availablePrevBlocks } = useAvailableBlocks(data.type, data.isInIteration || data.isInLoop)
  const isConnectable = !!availablePrevBlocks.length

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    if (!connected)
      setOpen(v => !v)
  }, [connected])
  const handleSelect = useCallback((type: BlockEnum, toolDefaultValue?: ToolDefaultValue | DataSourceDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        nextNodeId: id,
        nextNodeTargetHandle: handleId,
      },
    )
  }, [handleNodeAdd, id, handleId])

  return (
    <>
      <Handle
        id={handleId}
        type='target'
        position={Position.Left}
        className={cn(
          'z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
          'after:absolute after:left-1.5 after:top-1 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
          'transition-all hover:scale-125',
          data._runningStatus === NodeRunningStatus.Succeeded && 'after:bg-workflow-link-line-success-handle',
          data._runningStatus === NodeRunningStatus.Failed && 'after:bg-workflow-link-line-error-handle',
          data._runningStatus === NodeRunningStatus.Exception && 'after:bg-workflow-link-line-failure-handle',
          !connected && 'after:opacity-0',
          data.type === BlockEnum.Start && 'opacity-0',
          handleClassName,
        )}
        isConnectable={isConnectable}
        onClick={handleHandleClick}
      >
        {
          !connected && isConnectable && !getNodesReadOnly() && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={handleSelect}
              asChild
              placement='left'
              triggerClassName={open => `
                hidden absolute left-0 top-0 pointer-events-none
                ${nodeSelectorClassName}
                group-hover:!flex
                ${data.selected && '!flex'}
                ${open && '!flex'}
              `}
              availableBlocksTypes={availablePrevBlocks}
            />
          )
        }
      </Handle>
    </>
  )
})
NodeTargetHandle.displayName = 'NodeTargetHandle'

export const NodeSourceHandle = memo(({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
  showExceptionStatus,
}: NodeHandleProps) => {
  const { t } = useTranslation()
  const notInitialWorkflow = useStore(s => s.notInitialWorkflow)
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInIteration || data.isInLoop)
  const isConnectable = !!availableNextBlocks.length
  const isChatMode = useIsChatMode()

  const connected = data._connectedSourceHandleIds?.includes(handleId)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [])
  const handleSelect = useCallback((type: BlockEnum, toolDefaultValue?: ToolDefaultValue | DataSourceDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        prevNodeId: id,
        prevNodeSourceHandle: handleId,
      },
    )
  }, [handleNodeAdd, id, handleId])

  useEffect(() => {
    if (notInitialWorkflow && data.type === BlockEnum.Start && !isChatMode)
      setOpen(true)
  }, [notInitialWorkflow, data.type, isChatMode])

  return (
    <Handle
      id={handleId}
      type='source'
      position={Position.Right}
      className={cn(
        'group/handle z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
        'after:absolute after:right-1.5 after:top-1 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
        'transition-all hover:scale-125',
        data._runningStatus === NodeRunningStatus.Succeeded && 'after:bg-workflow-link-line-success-handle',
        data._runningStatus === NodeRunningStatus.Failed && 'after:bg-workflow-link-line-error-handle',
        showExceptionStatus && data._runningStatus === NodeRunningStatus.Exception && 'after:bg-workflow-link-line-failure-handle',
        !connected && 'after:opacity-0',
        handleClassName,
      )}
      isConnectable={isConnectable}
      onClick={handleHandleClick}
    >
      <div className='absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg group-hover/handle:block'>
        <div className='system-xs-regular text-text-tertiary'>
          <div className=' whitespace-nowrap'>
            <span className='system-xs-medium text-text-secondary'>{t('workflow.common.parallelTip.click.title')}</span>
            {t('workflow.common.parallelTip.click.desc')}
          </div>
          <div>
            <span className='system-xs-medium text-text-secondary'>{t('workflow.common.parallelTip.drag.title')}</span>
            {t('workflow.common.parallelTip.drag.desc')}
          </div>
        </div>
      </div>
      {
        isConnectable && !getNodesReadOnly() && (
          <BlockSelector
            open={open}
            onOpenChange={handleOpenChange}
            onSelect={handleSelect}
            asChild
            triggerClassName={open => `
              hidden absolute top-0 left-0 pointer-events-none
              ${nodeSelectorClassName}
              group-hover:!flex
              ${data.selected && '!flex'}
              ${open && '!flex'}
            `}
            availableBlocksTypes={availableNextBlocks}
          />
        )
      }
    </Handle>
  )
})
NodeSourceHandle.displayName = 'NodeSourceHandle'
