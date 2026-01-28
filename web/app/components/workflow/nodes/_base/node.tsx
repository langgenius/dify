import type {
  FC,
  ReactElement,
} from 'react'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { NodeProps } from '@/app/components/workflow/types'
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import {
  cloneElement,
  memo,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { ToolTypeEnum } from '@/app/components/workflow/block-selector/types'
import { useNodesReadOnly, useToolIcon } from '@/app/components/workflow/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { useNodeIterationInteractions } from '@/app/components/workflow/nodes/iteration/use-interactions'
import { useNodeLoopInteractions } from '@/app/components/workflow/nodes/loop/use-interactions'
import CopyID from '@/app/components/workflow/nodes/tool/components/copy-id'
import {
  BlockEnum,
  isTriggerNode,
  NodeRunningStatus,
} from '@/app/components/workflow/types'
import { hasErrorHandleNode, hasRetryNode } from '@/app/components/workflow/utils'
import { cn } from '@/utils/classnames'
import AddVariablePopupWithPosition from './components/add-variable-popup-with-position'
import EntryNodeContainer, { StartNodeTypeEnum } from './components/entry-node-container'
import ErrorHandleOnNode from './components/error-handle/error-handle-on-node'
import NodeControl from './components/node-control'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from './components/node-handle'
import NodeResizer from './components/node-resizer'
import RetryOnNode from './components/retry/retry-on-node'

type NodeChildProps = {
  id: string
  data: NodeProps['data']
}

type BaseNodeProps = {
  children: ReactElement<Partial<NodeChildProps>>
  id: NodeProps['id']
  data: NodeProps['data']
}

const BaseNode: FC<BaseNodeProps> = ({
  id,
  data,
  children,
}) => {
  const { t } = useTranslation()
  const nodeRef = useRef<HTMLDivElement>(null)
  const { nodesReadOnly } = useNodesReadOnly()

  const { handleNodeIterationChildSizeChange } = useNodeIterationInteractions()
  const { handleNodeLoopChildSizeChange } = useNodeLoopInteractions()
  const toolIcon = useToolIcon(data)

  useEffect(() => {
    if (nodeRef.current && data.selected && data.isInIteration) {
      const resizeObserver = new ResizeObserver(() => {
        handleNodeIterationChildSizeChange(id)
      })

      resizeObserver.observe(nodeRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [data.isInIteration, data.selected, id, handleNodeIterationChildSizeChange])

  useEffect(() => {
    if (nodeRef.current && data.selected && data.isInLoop) {
      const resizeObserver = new ResizeObserver(() => {
        handleNodeLoopChildSizeChange(id)
      })

      resizeObserver.observe(nodeRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [data.isInLoop, data.selected, id, handleNodeLoopChildSizeChange])

  const { hasNodeInspectVars } = useInspectVarsCrud()
  const isLoading = data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running
  const hasVarValue = hasNodeInspectVars(id)
  const showSelectedBorder = data.selected || data._isBundled || data._isEntering
  const {
    showRunningBorder,
    showSuccessBorder,
    showFailedBorder,
    showExceptionBorder,
  } = useMemo(() => {
    return {
      showRunningBorder: data._runningStatus === NodeRunningStatus.Running && !showSelectedBorder,
      showSuccessBorder: (data._runningStatus === NodeRunningStatus.Succeeded || hasVarValue) && !showSelectedBorder,
      showFailedBorder: data._runningStatus === NodeRunningStatus.Failed && !showSelectedBorder,
      showExceptionBorder: data._runningStatus === NodeRunningStatus.Exception && !showSelectedBorder,
    }
  }, [data._runningStatus, hasVarValue, showSelectedBorder])

  const LoopIndex = useMemo(() => {
    let text = ''

    if (data._runningStatus === NodeRunningStatus.Running)
      text = t('nodes.loop.currentLoopCount', { ns: 'workflow', count: data._loopIndex })
    if (data._runningStatus === NodeRunningStatus.Succeeded || data._runningStatus === NodeRunningStatus.Failed)
      text = t('nodes.loop.totalLoopCount', { ns: 'workflow', count: data._loopIndex })

    if (text) {
      return (
        <div
          className={cn(
            'system-xs-medium mr-2 text-text-tertiary',
            data._runningStatus === NodeRunningStatus.Running && 'text-text-accent',
          )}
        >
          {text}
        </div>
      )
    }

    return null
  }, [data._loopIndex, data._runningStatus, t])

  const nodeContent = (
    <div
      className={cn(
        'relative flex rounded-2xl border',
        showSelectedBorder ? 'border-components-option-card-option-selected-border' : 'border-transparent',
        data._waitingRun && 'opacity-70',
        data._pluginInstallLocked && 'cursor-not-allowed',
      )}
      ref={nodeRef}
      style={{
        width: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.width : 'auto',
        height: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.height : 'auto',
      }}
    >
      {(data._dimmed || data._pluginInstallLocked) && (
        <div
          className={cn(
            'absolute inset-0 rounded-2xl transition-opacity',
            data._pluginInstallLocked
              ? 'pointer-events-auto z-30 bg-workflow-block-parma-bg opacity-80 backdrop-blur-[2px]'
              : 'pointer-events-none z-20 bg-workflow-block-parma-bg opacity-50',
          )}
          data-testid="workflow-node-install-overlay"
        />
      )}
      {
        data.type === BlockEnum.DataSource && (
          <div className="absolute inset-[-2px] top-[-22px] z-[-1] rounded-[18px] bg-node-data-source-bg p-0.5 backdrop-blur-[6px]">
            <div className="system-2xs-semibold-uppercase flex h-5 items-center px-2.5 text-text-tertiary">
              {t('blocks.datasource', { ns: 'workflow' })}
            </div>
          </div>
        )
      }
      <div
        className={cn(
          'group relative pb-1 shadow-xs',
          'rounded-[15px] border border-transparent',
          (data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop) && 'w-[240px] bg-workflow-block-bg',
          (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) && 'flex h-full w-full flex-col border-workflow-block-border bg-workflow-block-bg-transparent',
          !data._runningStatus && 'hover:shadow-lg',
          showRunningBorder && '!border-state-accent-solid',
          showSuccessBorder && '!border-state-success-solid',
          showFailedBorder && '!border-state-destructive-solid',
          showExceptionBorder && '!border-state-warning-solid',
          data._isBundled && '!shadow-lg',
        )}
      >
        {
          data._showAddVariablePopup && (
            <AddVariablePopupWithPosition
              nodeId={id}
              nodeData={data}
            />
          )
        }
        {
          data.type === BlockEnum.Iteration && (
            <NodeResizer
              nodeId={id}
              nodeData={data}
            />
          )
        }
        {
          data.type === BlockEnum.Loop && (
            <NodeResizer
              nodeId={id}
              nodeData={data}
            />
          )
        }
        {
          !data._isCandidate && (
            <NodeTargetHandle
              id={id}
              data={data}
              handleClassName="!top-4 !-left-[9px] !translate-y-0"
              handleId="target"
            />
          )
        }
        {
          data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && !data._isCandidate && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleClassName="!top-4 !-right-[9px] !translate-y-0"
              handleId="source"
            />
          )
        }
        {
          !data._runningStatus && !nodesReadOnly && !data._isCandidate && (
            <NodeControl
              id={id}
              data={data}
            />
          )
        }
        <div className={cn(
          'flex items-center rounded-t-2xl px-3 pb-2 pt-3',
          (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) && 'bg-transparent',
        )}
        >
          <BlockIcon
            className="mr-2 shrink-0"
            type={data.type}
            size="md"
            toolIcon={toolIcon}
          />
          <div
            title={data.title}
            className="system-sm-semibold-uppercase mr-1 flex grow items-center truncate text-text-primary"
          >
            <div>
              {data.title}
            </div>
            {
              data.type === BlockEnum.Iteration && (data as IterationNodeType).is_parallel && (
                <Tooltip popupContent={(
                  <div className="w-[180px]">
                    <div className="font-extrabold">
                      {t('nodes.iteration.parallelModeEnableTitle', { ns: 'workflow' })}
                    </div>
                    {t('nodes.iteration.parallelModeEnableDesc', { ns: 'workflow' })}
                  </div>
                )}
                >
                  <div className="system-2xs-medium-uppercase ml-1 flex items-center justify-center rounded-[5px] border-[1px] border-text-warning px-[5px] py-[3px] text-text-warning ">
                    {t('nodes.iteration.parallelModeUpper', { ns: 'workflow' })}
                  </div>
                </Tooltip>
              )
            }
          </div>
          {
            !!(data._iterationLength && data._iterationIndex && data._runningStatus === NodeRunningStatus.Running) && (
              <div className="mr-1.5 text-xs font-medium text-text-accent">
                {data._iterationIndex > data._iterationLength ? data._iterationLength : data._iterationIndex}
                /
                {data._iterationLength}
              </div>
            )
          }
          {
            !!(data.type === BlockEnum.Loop && data._loopIndex) && LoopIndex
          }
          {
            isLoading
              ? <RiLoader2Line className="h-3.5 w-3.5 animate-spin text-text-accent" />
              : data._runningStatus === NodeRunningStatus.Failed
                ? <RiErrorWarningFill className="h-3.5 w-3.5 text-text-destructive" />
                : data._runningStatus === NodeRunningStatus.Exception
                  ? <RiAlertFill className="h-3.5 w-3.5 text-text-warning-secondary" />
                  : (data._runningStatus === NodeRunningStatus.Succeeded || hasVarValue)
                      ? <RiCheckboxCircleFill className="h-3.5 w-3.5 text-text-success" />
                      : null
          }
        </div>
        {
          data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop && (
            cloneElement(children, { id, data } as any)
          )
        }
        {
          (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) && (
            <div className="grow pb-1 pl-1 pr-1">
              {cloneElement(children, { id, data } as any)}
            </div>
          )
        }
        {
          hasRetryNode(data.type) && (
            <RetryOnNode
              id={id}
              data={data}
            />
          )
        }
        {
          hasErrorHandleNode(data.type) && (
            <ErrorHandleOnNode
              id={id}
              data={data}
            />
          )
        }
        {
          !!(data.desc && data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop) && (
            <div className="system-xs-regular whitespace-pre-line break-words px-3 pb-2 pt-1 text-text-tertiary">
              {data.desc}
            </div>
          )
        }
        {data.type === BlockEnum.Tool && data.provider_type === ToolTypeEnum.MCP && (
          <div className="px-3 pb-2">
            <CopyID content={data.provider_id || ''} />
          </div>
        )}
      </div>
    </div>
  )

  const isStartNode = data.type === BlockEnum.Start
  const isEntryNode = isTriggerNode(data.type as any) || isStartNode

  return isEntryNode
    ? (
        <EntryNodeContainer
          nodeType={isStartNode ? StartNodeTypeEnum.Start : StartNodeTypeEnum.Trigger}
        >
          {nodeContent}
        </EntryNodeContainer>
      )
    : nodeContent
}

export default memo(BaseNode)
