import type {
  FC,
  ReactNode,
} from 'react'
import {
  cloneElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import {
  RiCloseLine,
  RiPlayLargeLine,
} from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import NextStep from '../next-step'
import PanelOperator from '../panel-operator'
import HelpLink from '../help-link'
import {
  DescriptionInput,
  TitleInput,
} from '../title-description-input'
import ErrorHandleOnPanel from '../error-handle/error-handle-on-panel'
import RetryOnPanel from '../retry/retry-on-panel'
import { useResizePanel } from '../../hooks/use-resize-panel'
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
import Tab, { TabType } from './tab'
import LastRun from './last-run'
import useLastRun from './last-run/use-last-run'
import BeforeRunForm from '../before-run-form'
import { debounce } from 'lodash-es'
import { NODES_EXTRA_DATA } from '@/app/components/workflow/constants'

type BasePanelProps = {
  children: ReactNode
} & Node

const BasePanel: FC<BasePanelProps> = ({
  id,
  data,
  children,
}) => {
  const { t } = useTranslation()
  const { showMessageLogModal } = useAppStore(useShallow(state => ({
    showMessageLogModal: state.showMessageLogModal,
  })))
  const showSingleRunPanel = useStore(s => s.showSingleRunPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const nodePanelWidth = useStore(s => s.nodePanelWidth)
  const otherPanelWidth = useStore(s => s.otherPanelWidth)
  const setNodePanelWidth = useStore(s => s.setNodePanelWidth)

  const maxNodePanelWidth = useMemo(() => {
    if (!workflowCanvasWidth)
      return 720
    if (!otherPanelWidth)
      return workflowCanvasWidth - 400

    return workflowCanvasWidth - otherPanelWidth - 400
  }, [workflowCanvasWidth, otherPanelWidth])

  const updateNodePanelWidth = useCallback((width: number) => {
    // Ensure the width is within the min and max range
    const newValue = Math.min(Math.max(width, 400), maxNodePanelWidth)
    localStorage.setItem('workflow-node-panel-width', `${newValue}`)
    setNodePanelWidth(newValue)
  }, [maxNodePanelWidth, setNodePanelWidth])

  const handleResize = useCallback((width: number) => {
    updateNodePanelWidth(width)
  }, [updateNodePanelWidth])

  const {
    triggerRef,
    containerRef,
  } = useResizePanel({
    direction: 'horizontal',
    triggerDirection: 'left',
    minWidth: 400,
    maxWidth: maxNodePanelWidth,
    onResize: debounce(handleResize),
  })

  const debounceUpdate = debounce(updateNodePanelWidth)
  useEffect(() => {
    if (!workflowCanvasWidth)
      return
    if (workflowCanvasWidth - 400 <= nodePanelWidth + otherPanelWidth)
      debounceUpdate(workflowCanvasWidth - 400 - otherPanelWidth)
  }, [nodePanelWidth, otherPanelWidth, workflowCanvasWidth, updateNodePanelWidth])

  const { handleNodeSelect } = useNodesInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInIteration, data.isInLoop)
  const toolIcon = useToolIcon(data)

  const { saveStateToHistory } = useWorkflowHistory()

  const {
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

  const isSupportSingleRun = canRunBySingle(data.type)
  const appDetail = useAppStore(state => state.appDetail)

  const {
    isShowSingleRun,
    showSingleRun,
    hideSingleRun,
    runningStatus,
    handleStop,
    runInputData,
    runInputDataRef,
    runResult,
    getInputVars,
    toVarInputs,
    tabType,
    setTabType,
    singleRunParams,
    setRunInputData,
    hasLastRunData,
    handleRun,
    getExistVarValuesInForms,
    getFilteredExistVarForms,
  } = useLastRun<typeof data>({
    id,
    data,
    defaultRunInputData: NODES_EXTRA_DATA[data.type]?.defaultRunInputData || {},
  })

  if (isShowSingleRun) {
    return (
      <div className={cn(
        'relative mr-1  h-full',
      )}>
        <div
          ref={containerRef}
          className={cn('flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
          style={{
            width: `${nodePanelWidth}px`,
          }}
        >
          <BeforeRunForm
            nodeName={data.title}
            nodeType={data.type}
            onHide={hideSingleRun}
            runningStatus={runningStatus}
            onRun={handleRun}
            onStop={handleStop}
            {...singleRunParams!}
            existVarValuesInForms={getExistVarValuesInForms(singleRunParams?.forms as any)}
            filteredExistVarForms={getFilteredExistVarForms(singleRunParams?.forms as any)}
            result={<></>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'relative mr-1  h-full',
      showMessageLogModal && '!absolute -top-[5px] right-[416px] z-0 !mr-0 w-[384px] overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border shadow-lg transition-all',
    )}>
      <div
        ref={triggerRef}
        className='absolute -left-1 top-0 flex h-full w-1 cursor-col-resize resize-x items-center justify-center'>
        <div className='h-10 w-0.5 rounded-sm bg-state-base-handle hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid'></div>
      </div>
      <div
        ref={containerRef}
        className={cn('flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
        style={{
          width: `${nodePanelWidth}px`,
        }}
      >
        <div className='sticky top-0 z-10 shrink-0 border-b-[0.5px] border-divider-regular bg-components-panel-bg'>
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
                isSupportSingleRun && !nodesReadOnly && (
                  <Tooltip
                    popupContent={t('workflow.panel.runThisStep')}
                    popupClassName='mr-1'
                  >
                    <div
                      className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
                      onClick={() => {
                        const filteredExistVarForms = getFilteredExistVarForms(singleRunParams.forms)
                        if (filteredExistVarForms.length > 0) {
                          showSingleRun()
                        }
                        else {
                          // TODO: check valid
                          // TODO: all value is setted. wait for api if need to pass exist var values
                          handleRun({})
                        }
                        handleSyncWorkflowDraft(true)
                      }}
                    >
                      <RiPlayLargeLine className='h-4 w-4 text-text-tertiary' />
                    </div>
                  </Tooltip>
                )
              }
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
          <div className='pl-4'>
            <Tab
              value={tabType}
              onChange={setTabType}
              canSwitchToLastRun={hasLastRunData}
            />
          </div>
          <Split />
        </div>

        {tabType === TabType.settings && (
          <>
            <div>
              {cloneElement(children as any, {
                id,
                data,
                panelProps: {
                  getInputVars,
                  toVarInputs,
                  runInputData,
                  setRunInputData,
                  runResult,
                  runInputDataRef,
                },
              })}
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
          </>
        )}

        {tabType === TabType.lastRun && (
          <LastRun appId={appDetail?.id || ''} nodeId={id} runningStatus={runningStatus} />
        )}
      </div>
    </div>
  )
}

export default memo(BasePanel)
