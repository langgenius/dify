import type {
  FC,
  ReactNode,
} from 'react'
import {
  cloneElement,
  memo,
  useCallback,
} from 'react'
import {
  RiCloseLine,
  RiPlayLargeLine,
} from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import NextStep from './components/next-step'
import PanelOperator from './components/panel-operator'
import HelpLink from './components/help-link'
import NodePosition from './components/node-position'
import {
  DescriptionInput,
  TitleInput,
} from './components/title-description-input'
import ErrorHandleOnPanel from './components/error-handle/error-handle-on-panel'
import RetryOnPanel from './components/retry/retry-on-panel'
import { useResizePanel } from './hooks/use-resize-panel'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import {
  WorkflowHistoryEvent,
  useAvailableBlocks,
  useNodeDataUpdate,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  useToolIcon,
  useWorkflow,
  useWorkflowHistory,
} from '@/app/components/workflow/hooks'
import {
  canRunBySingle,
  hasErrorHandleNode,
  hasRetryNode,
} from '@/app/components/workflow/utils'
import Tooltip from '@/app/components/base/tooltip'
import type { Node } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore } from '@/app/components/workflow/store'

type BasePanelProps = {
  children: ReactNode
} & Node

const BasePanel: FC<BasePanelProps> = ({
  id,
  data,
  children,
  position,
  width,
  height,
}) => {
  const { t } = useTranslation()
  const { showMessageLogModal } = useAppStore(useShallow(state => ({
    showMessageLogModal: state.showMessageLogModal,
  })))
  const showSingleRunPanel = useStore(s => s.showSingleRunPanel)
  const panelWidth = localStorage.getItem('workflow-node-panel-width') ? Number.parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 420
  const {
    setPanelWidth,
  } = useWorkflow()
  const { handleNodeSelect } = useNodesInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInIteration, data.isInLoop)
  const toolIcon = useToolIcon(data)

  const handleResize = useCallback((width: number) => {
    setPanelWidth(width)
  }, [setPanelWidth])

  const {
    triggerRef,
    containerRef,
  } = useResizePanel({
    direction: 'horizontal',
    triggerDirection: 'left',
    minWidth: 420,
    maxWidth: 720,
    onResize: handleResize,
  })

  const { saveStateToHistory } = useWorkflowHistory()

  const {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  } = useNodeDataUpdate()

  const handleTitleBlur = useCallback((title: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { title } })
    saveStateToHistory(WorkflowHistoryEvent.NodeTitleChange)
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])
  const handleDescriptionChange = useCallback((desc: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { desc } })
    saveStateToHistory(WorkflowHistoryEvent.NodeDescriptionChange)
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])

  return (
    <div className={cn(
      'relative mr-2 h-full',
      showMessageLogModal && '!absolute -top-[5px] right-[416px] z-0 !mr-0 w-[384px] overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border shadow-lg transition-all',
    )}>
      <div
        ref={triggerRef}
        className='absolute -left-2 top-1/2 h-6 w-3 -translate-y-1/2 cursor-col-resize resize-x'>
        <div className='h-6 w-1 rounded-sm bg-divider-regular'></div>
      </div>
      <div
        ref={containerRef}
        className={cn('h-full rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
        style={{
          width: `${panelWidth}px`,
        }}
      >
        <div className='sticky top-0 z-10 border-b-[0.5px] border-divider-regular bg-components-panel-bg'>
          <div className='flex items-center px-4 pb-1 pt-4'>
            <BlockIcon
              className='mr-1 shrink-0'
              type={data.type}
              toolIcon={toolIcon}
              size='md'
            />
            <TitleInput
              value={data.title || ''}
              onBlur={handleTitleBlur}
            />
            <div className='flex shrink-0 items-center text-text-tertiary'>
              {
                canRunBySingle(data.type) && !nodesReadOnly && (
                  <Tooltip
                    popupContent={t('workflow.panel.runThisStep')}
                    popupClassName='mr-1'
                  >
                    <div
                      className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
                      onClick={() => {
                        handleNodeDataUpdate({ id, data: { _isSingleRun: true } })
                        handleSyncWorkflowDraft(true)
                      }}
                    >
                      <RiPlayLargeLine className='h-4 w-4 text-text-tertiary' />
                    </div>
                  </Tooltip>
                )
              }
              <NodePosition nodePosition={position} nodeWidth={width} nodeHeight={height}></NodePosition>
              <HelpLink nodeType={data.type} />
              <PanelOperator id={id} data={data} showHelpLink={false} />
              <div className='mx-3 h-3.5 w-[1px] bg-divider-regular' />
              <div
                className='flex h-6 w-6 cursor-pointer items-center justify-center'
                onClick={() => handleNodeSelect(id, true)}
              >
                <RiCloseLine className='h-4 w-4 text-text-tertiary' />
              </div>
            </div>
          </div>
          <div className='p-2'>
            <DescriptionInput
              value={data.desc || ''}
              onChange={handleDescriptionChange}
            />
          </div>
        </div>
        <div>
          {cloneElement(children as any, { id, data })}
        </div>
        <Split />
        {
          hasRetryNode(data.type) && (
            <RetryOnPanel
              id={id}
              data={data}
            />
          )
        }
        {
          hasErrorHandleNode(data.type) && (
            <ErrorHandleOnPanel
              id={id}
              data={data}
            />
          )
        }
        {
          !!availableNextBlocks.length && (
            <div className='border-t-[0.5px] border-divider-regular p-4'>
              <div className='system-sm-semibold-uppercase mb-1 flex items-center text-text-secondary'>
                {t('workflow.panel.nextStep').toLocaleUpperCase()}
              </div>
              <div className='system-xs-regular mb-2 text-text-tertiary'>
                {t('workflow.panel.addNextStep')}
              </div>
              <NextStep selectedNode={{ id, data } as Node} />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BasePanel)
