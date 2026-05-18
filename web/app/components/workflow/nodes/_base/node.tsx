import type {
  FC,
  ReactElement,
} from 'react'
import type { NodeProps } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  cloneElement,
  memo,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import BlockIcon from '@/app/components/workflow/block-icon'
import { ToolTypeEnum } from '@/app/components/workflow/block-selector/types'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import { useNodesReadOnly, useToolIcon } from '@/app/components/workflow/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { useNodeIterationInteractions } from '@/app/components/workflow/nodes/iteration/use-interactions'
import { useNodeLoopInteractions } from '@/app/components/workflow/nodes/loop/use-interactions'
import CopyID from '@/app/components/workflow/nodes/tool/components/copy-id'
import { useStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  ControlMode,
  NodeRunningStatus,
} from '@/app/components/workflow/types'
import { hasErrorHandleNode, hasRetryNode } from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
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
import {
  NodeBody,
  NodeDescription,
  NodeHeaderMeta,
} from './node-sections'
import {
  getLoopIndexTextKey,
  getNodeStatusBorders,
  isContainerNode,
  isEntryWorkflowNode,
} from './node.helpers'
import useNodeResizeObserver from './use-node-resize-observer'

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
  const { userProfile } = useAppContext()
  const appId = useStore(s => s.appId)
  const { nodePanelPresence } = useCollaboration(appId as string)
  const controlMode = useStore(s => s.controlMode)
  const isContextMenuTarget = useStore(s => s.nodeMenu?.nodeId === id)

  const currentUserPresence = useMemo(() => {
    const userId = userProfile?.id || ''
    const username = userProfile?.name || userProfile?.email || 'User'
    const avatar = userProfile?.avatar_url || userProfile?.avatar || null

    return {
      userId,
      username,
      avatar,
    }
  }, [userProfile?.avatar, userProfile?.avatar_url, userProfile?.email, userProfile?.id, userProfile?.name])

  const viewingUsers = useMemo(() => {
    const presence = nodePanelPresence?.[id]
    if (!presence)
      return []

    return Object.values(presence)
      .filter(viewer => viewer.userId && viewer.userId !== currentUserPresence.userId)
      .map(viewer => ({
        id: viewer.userId,
        name: viewer.username,
        avatar_url: viewer.avatar || null,
      }))
  }, [currentUserPresence.userId, id, nodePanelPresence])
  const { shouldDim: pluginDimmed, isChecking: pluginIsChecking, isMissing: pluginIsMissing, canInstall: pluginCanInstall, uniqueIdentifier: pluginUniqueIdentifier } = useNodePluginInstallation(data)
  const pluginInstallLocked = !pluginIsChecking && pluginIsMissing && pluginCanInstall && Boolean(pluginUniqueIdentifier)

  useNodeResizeObserver({
    enabled: Boolean(data.selected && data.isInIteration),
    nodeRef,
    onResize: () => handleNodeIterationChildSizeChange(id),
  })

  useNodeResizeObserver({
    enabled: Boolean(data.selected && data.isInLoop),
    nodeRef,
    onResize: () => handleNodeLoopChildSizeChange(id),
  })

  const { hasNodeInspectVars } = useInspectVarsCrud()
  const isLoading = data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running
  const hasVarValue = hasNodeInspectVars(id)
  const showSelectedBorder = Boolean(data.selected || isContextMenuTarget || data._isBundled || data._isEntering)
  const {
    showRunningBorder,
    showSuccessBorder,
    showFailedBorder,
    showExceptionBorder,
  } = useMemo(() => getNodeStatusBorders(data._runningStatus, hasVarValue, showSelectedBorder), [data._runningStatus, hasVarValue, showSelectedBorder])

  const LoopIndex = useMemo(() => {
    const translationKey = getLoopIndexTextKey(data._runningStatus)
    const text = translationKey
      ? t(translationKey, { ns: 'workflow', count: data._loopIndex })
      : ''

    if (text) {
      return (
        <div
          className={cn(
            'mr-2 system-xs-medium text-text-tertiary',
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
        pluginInstallLocked && 'cursor-not-allowed',
      )}
      ref={nodeRef}
      style={{
        width: isContainerNode(data.type) ? data.width : 'auto',
        height: isContainerNode(data.type) ? data.height : 'auto',
      }}
    >
      {(data._dimmed || pluginDimmed || pluginInstallLocked) && (
        <div
          className={cn(
            'absolute inset-0 rounded-2xl transition-opacity',
            pluginInstallLocked
              ? 'pointer-events-auto z-30 bg-workflow-block-parma-bg opacity-80 backdrop-blur-[2px]'
              : 'pointer-events-none z-20 bg-workflow-block-parma-bg opacity-50',
          )}
          onClick={pluginInstallLocked ? e => e.stopPropagation() : undefined}
          data-testid="workflow-node-install-overlay"
        />
      )}
      {
        data.type === BlockEnum.DataSource && (
          <div className="absolute inset-[-2px] top-[-22px] z-[-1] rounded-[18px] bg-node-data-source-bg p-0.5 backdrop-blur-[6px]">
            <div className="flex h-5 items-center px-2.5 system-2xs-semibold-uppercase text-text-tertiary">
              {t('blocks.datasource', { ns: 'workflow' })}
            </div>
          </div>
        )
      }
      <div
        className={cn(
          'group relative pb-1 shadow-xs',
          'rounded-[15px] border border-transparent',
          (controlMode === ControlMode.Comment) && 'hover:cursor-none',
          !isContainerNode(data.type) && 'w-[240px] bg-workflow-block-bg',
          isContainerNode(data.type) && 'flex h-full w-full flex-col border-workflow-block-border bg-workflow-block-bg-transparent',
          !data._runningStatus && 'hover:shadow-lg',
          showRunningBorder && 'border-state-accent-solid!',
          showSuccessBorder && 'border-state-success-solid!',
          showFailedBorder && 'border-state-destructive-solid!',
          showExceptionBorder && 'border-state-warning-solid!',
          data._isBundled && 'shadow-lg!',
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
              handleClassName="top-4! -left-[9px]! translate-y-0!"
              handleId="target"
            />
          )
        }
        {
          data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && data.type !== BlockEnum.HumanInput && !data._isCandidate && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleClassName="top-4! -right-[9px]! translate-y-0!"
              handleId="source"
            />
          )
        }
        {
          !data._runningStatus && !nodesReadOnly && !data._isCandidate && (
            <NodeControl
              id={id}
              data={data}
              pluginInstallLocked={pluginInstallLocked}
            />
          )
        }
        <div className={cn(
          'flex items-center rounded-t-2xl px-3 pt-3 pb-2',
          isContainerNode(data.type) && 'bg-transparent',
        )}
        >
          <BlockIcon
            className="mr-2 shrink-0"
            type={data.type}
            size="md"
            toolIcon={toolIcon}
          />
          <div
            className="mr-1 flex min-w-0 grow items-center system-sm-semibold-uppercase text-text-primary"
          >
            <div title={data.title} className="min-w-0 grow truncate">
              {data.title}
            </div>
            {viewingUsers.length > 0 && (
              <div className="ml-3 shrink-0">
                <UserAvatarList
                  users={viewingUsers}
                  maxVisible={3}
                  size="sm"
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <NodeHeaderMeta
              data={data}
              hasVarValue={hasVarValue}
              isLoading={isLoading}
              loopIndex={LoopIndex}
              t={t}
            />
          </div>
        </div>
        <NodeBody
          data={data}
          child={cloneElement(children, { id, data } as any)}
        />
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
        <NodeDescription data={data} />
        {data.type === BlockEnum.Tool && data.provider_type === ToolTypeEnum.MCP && (
          <div className="px-3 pb-2">
            <CopyID content={data.provider_id || ''} />
          </div>
        )}
      </div>
    </div>
  )

  const isStartNode = data.type === BlockEnum.Start
  const isEntryNode = isEntryWorkflowNode(data.type)

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
