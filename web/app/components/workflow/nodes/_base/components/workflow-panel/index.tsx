import type {
  FC,
  ReactNode,
} from 'react'
import React, {
  cloneElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  RiCloseLine,
  RiPlayLargeLine,
} from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import NextStep from '../next-step'
import PanelOperator from '../panel-operator'
import NodePosition from '@/app/components/workflow/nodes/_base/components/node-position'
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
  useNodesMetaData,
  useNodesReadOnly,
  useToolIcon,
  useWorkflowHistory,
} from '@/app/components/workflow/hooks'
import {
  canRunBySingle,
  hasErrorHandleNode,
  hasRetryNode,
  isSupportCustomRunForm,
} from '@/app/components/workflow/utils'
import Tooltip from '@/app/components/base/tooltip'
import { BlockEnum, type Node, NodeRunningStatus } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore } from '@/app/components/workflow/store'
import Tab, { TabType } from './tab'
import LastRun from './last-run'
import useLastRun from './last-run/use-last-run'
import BeforeRunForm from '../before-run-form'
import { debounce } from 'lodash-es'
import { useLogs } from '@/app/components/workflow/run/hooks'
import PanelWrap from '../before-run-form/panel-wrap'
import SpecialResultPanel from '@/app/components/workflow/run/special-result-panel'
import { Stop } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { FlowType } from '@/types/common'
import {
  AuthorizedInDataSourceNode,
  AuthorizedInNode,
  PluginAuth,
  PluginAuthInDataSourceNode,
} from '@/app/components/plugins/plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth'
import { canFindTool } from '@/utils'
import type { CustomRunFormProps } from '@/app/components/workflow/nodes/data-source/types'
import { DataSourceClassification } from '@/app/components/workflow/nodes/data-source/types'
import { useModalContext } from '@/context/modal-context'
import DataSourceBeforeRunForm from '@/app/components/workflow/nodes/data-source/before-run-form'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { useAllBuiltInTools } from '@/service/use-tools'

const getCustomRunForm = (params: CustomRunFormProps): React.JSX.Element => {
  const nodeType = params.payload.type
  switch (nodeType) {
    case BlockEnum.DataSource:
      return <DataSourceBeforeRunForm {...params} />
    default:
      return <div>Custom Run Form: {nodeType} not found</div>
  }
}
type BasePanelProps = {
  children: ReactNode
  id: Node['id']
  data: Node['data']
}

const BasePanel: FC<BasePanelProps> = ({
  id,
  data,
  children,
}) => {
  const { t } = useTranslation()
  const { showMessageLogModal } = useAppStore(useShallow(state => ({
    showMessageLogModal: state.showMessageLogModal,
  })))
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running

  const showSingleRunPanel = useStore(s => s.showSingleRunPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const nodePanelWidth = useStore(s => s.nodePanelWidth)
  const otherPanelWidth = useStore(s => s.otherPanelWidth)
  const setNodePanelWidth = useStore(s => s.setNodePanelWidth)

  const reservedCanvasWidth = 400 // Reserve the minimum visible width for the canvas

  const maxNodePanelWidth = useMemo(() => {
    if (!workflowCanvasWidth)
      return 720

    const available = workflowCanvasWidth - (otherPanelWidth || 0) - reservedCanvasWidth
    return Math.max(available, 400)
  }, [workflowCanvasWidth, otherPanelWidth])

  const updateNodePanelWidth = useCallback((width: number, source: 'user' | 'system' = 'user') => {
    // Ensure the width is within the min and max range
    const newValue = Math.max(400, Math.min(width, maxNodePanelWidth))

    if (source === 'user')
      localStorage.setItem('workflow-node-panel-width', `${newValue}`)

    setNodePanelWidth(newValue)
  }, [maxNodePanelWidth, setNodePanelWidth])

  const handleResize = useCallback((width: number) => {
    updateNodePanelWidth(width, 'user')
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

  const debounceUpdate = debounce((width: number) => {
    updateNodePanelWidth(width, 'system')
  })

  useEffect(() => {
    if (!workflowCanvasWidth)
      return

    // If the total width of the three exceeds the canvas, shrink the node panel to the available range (at least 400px)
    const total = nodePanelWidth + otherPanelWidth + reservedCanvasWidth
    if (total > workflowCanvasWidth) {
      const target = Math.max(workflowCanvasWidth - otherPanelWidth - reservedCanvasWidth, 400)
      debounceUpdate(target)
    }
  }, [nodePanelWidth, otherPanelWidth, workflowCanvasWidth, debounceUpdate])

  const { handleNodeSelect } = useNodesInteractions()
  const { nodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInIteration || data.isInLoop)
  const toolIcon = useToolIcon(data)

  const { saveStateToHistory } = useWorkflowHistory()

  const {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  } = useNodeDataUpdate()

  const handleTitleBlur = useCallback((title: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { title } })
    saveStateToHistory(WorkflowHistoryEvent.NodeTitleChange, { nodeId: id })
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])
  const handleDescriptionChange = useCallback((desc: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { desc } })
    saveStateToHistory(WorkflowHistoryEvent.NodeDescriptionChange, { nodeId: id })
  }, [handleNodeDataUpdateWithSyncDraft, id, saveStateToHistory])

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  const isSupportSingleRun = canRunBySingle(data.type, isChildNode)
  const appDetail = useAppStore(state => state.appDetail)

  const hasClickRunning = useRef(false)
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (data._singleRunningStatus === NodeRunningStatus.Running) {
      hasClickRunning.current = true
      setIsPaused(false)
    }
    else if (data._isSingleRun && data._singleRunningStatus === undefined && hasClickRunning) {
      setIsPaused(true)
      hasClickRunning.current = false
    }
  }, [data])

  const updateNodeRunningStatus = useCallback((status: NodeRunningStatus) => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: status,
      },
    })
  }, [handleNodeDataUpdate, id, data])

  useEffect(() => {
    hasClickRunning.current = false
  }, [id])
  const {
    nodesMap,
  } = useNodesMetaData()

  const configsMap = useHooksStore(s => s.configsMap)
  const {
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    runInputData,
    runInputDataRef,
    runResult,
    setRunResult,
    getInputVars,
    toVarInputs,
    tabType,
    isRunAfterSingleRun,
    setIsRunAfterSingleRun,
    setTabType,
    handleAfterCustomSingleRun,
    singleRunParams,
    nodeInfo,
    setRunInputData,
    handleSingleRun,
    handleRunWithParams,
    getExistVarValuesInForms,
    getFilteredExistVarForms,
  } = useLastRun<typeof data>({
    id,
    flowId: configsMap?.flowId || '',
    flowType: configsMap?.flowType || FlowType.appFlow,
    data,
    defaultRunInputData: nodesMap?.[data.type]?.defaultRunInputData || {},
    isPaused,
  })

  useEffect(() => {
    setIsPaused(false)
  }, [tabType])

  const logParams = useLogs()
  const passedLogParams = (() => {
    if ([BlockEnum.Tool, BlockEnum.Agent, BlockEnum.Iteration, BlockEnum.Loop].includes(data.type))
      return logParams

    return {}
  })()

  const { data: buildInTools } = useAllBuiltInTools()
  const currCollection = useMemo(() => {
    return buildInTools?.find(item => canFindTool(item.id, data.provider_id))
  }, [buildInTools, data.provider_id])
  const showPluginAuth = useMemo(() => {
    return data.type === BlockEnum.Tool && currCollection?.allow_delete
  }, [currCollection, data.type])
  const dataSourceList = useStore(s => s.dataSourceList)
  const currentDataSource = useMemo(() => {
    if (data.type === BlockEnum.DataSource && data.provider_type !== DataSourceClassification.localFile)
      return dataSourceList?.find(item => item.plugin_id === data.plugin_id)
  }, [dataSourceList, data.plugin_id, data.type, data.provider_type])
  const handleAuthorizationItemClick = useCallback((credential_id: string) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        credential_id,
      },
    })
  }, [handleNodeDataUpdateWithSyncDraft, id])
  const { setShowAccountSettingModal } = useModalContext()
  const handleJumpToDataSourcePage = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source' })
  }, [setShowAccountSettingModal])

  const {
    appendNodeInspectVars,
  } = useInspectVarsCrud()

  if (logParams.showSpecialResultPanel) {
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
          <PanelWrap
            nodeName={data.title}
            onHide={hideSingleRun}
          >
            <div className='h-0 grow overflow-y-auto pb-4'>
              <SpecialResultPanel {...passedLogParams} />
            </div>
          </PanelWrap>
        </div>
      </div>
    )
  }

  if (isShowSingleRun) {
    const form = getCustomRunForm({
      nodeId: id,
      flowId: configsMap?.flowId || '',
      flowType: configsMap?.flowType || FlowType.appFlow,
      payload: data,
      setRunResult,
      setIsRunAfterSingleRun,
      isPaused,
      isRunAfterSingleRun,
      onSuccess: handleAfterCustomSingleRun,
      onCancel: hideSingleRun,
      appendNodeInspectVars,
    })

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
          {isSupportCustomRunForm(data.type) ? (
            form
          ) : (
            <BeforeRunForm
              nodeName={data.title}
              nodeType={data.type}
              onHide={hideSingleRun}
              onRun={handleRunWithParams}
              {...singleRunParams!}
              {...passedLogParams}
              existVarValuesInForms={getExistVarValuesInForms(singleRunParams?.forms as any)}
              filteredExistVarForms={getFilteredExistVarForms(singleRunParams?.forms as any)}
            />
          )}

        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative mr-1 h-full',
        showMessageLogModal && 'absolute z-0 mr-2 w-[400px] overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border shadow-lg transition-all',
      )}
      style={{
        right: !showMessageLogModal ? '0' : `${otherPanelWidth}px`,
      }}
    >
      <div
        ref={triggerRef}
        className='absolute -left-1 top-0 flex h-full w-1 cursor-col-resize resize-x items-center justify-center'>
        <div className='h-10 w-0.5 rounded-sm bg-state-base-handle hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid'></div>
      </div>
      <div
        ref={containerRef}
        className={cn('flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg transition-[width] ease-linear', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
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
                    disabled={isSingleRunning}
                  >
                    <div
                      className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
                      onClick={() => {
                        if (isSingleRunning) {
                          handleNodeDataUpdate({
                            id,
                            data: {
                              _isSingleRun: false,
                              _singleRunningStatus: undefined,
                            },
                          })
                        }
                        else {
                          handleSingleRun()
                        }
                      }}
                    >
                      {
                        isSingleRunning ? <Stop className='h-4 w-4 text-text-tertiary' />
                          : <RiPlayLargeLine className='h-4 w-4 text-text-tertiary' />
                      }
                    </div>
                  </Tooltip>
                )
              }
              <NodePosition nodeId={id}></NodePosition>
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
          {
            showPluginAuth && (
              <PluginAuth
                className='px-4 pb-2'
                pluginPayload={{
                  provider: currCollection?.name || '',
                  providerType: currCollection?.type || '',
                  category: AuthCategory.tool,
                }}
              >
                <div className='flex items-center justify-between pl-4 pr-3'>
                  <Tab
                    value={tabType}
                    onChange={setTabType}
                  />
                  <AuthorizedInNode
                    pluginPayload={{
                      provider: currCollection?.name || '',
                      providerType: currCollection?.type || '',
                      category: AuthCategory.tool,
                    }}
                    onAuthorizationItemClick={handleAuthorizationItemClick}
                    credentialId={data.credential_id}
                  />
                </div>
              </PluginAuth>
            )
          }
          {
            !!currentDataSource && (
              <PluginAuthInDataSourceNode
                onJumpToDataSourcePage={handleJumpToDataSourcePage}
                isAuthorized={currentDataSource.is_authorized}
              >
                <div className='flex items-center justify-between pl-4 pr-3'>
                  <Tab
                    value={tabType}
                    onChange={setTabType}
                  />
                  <AuthorizedInDataSourceNode
                    onJumpToDataSourcePage={handleJumpToDataSourcePage}
                    authorizationsNum={3}
                  />
                </div>
              </PluginAuthInDataSourceNode>
            )
          }
          {
            !showPluginAuth && !currentDataSource && (
              <div className='flex items-center justify-between pl-4 pr-3'>
                <Tab
                  value={tabType}
                  onChange={setTabType}
                />
              </div>
            )
          }
          <Split />
        </div>
        {tabType === TabType.settings && (
          <div className='flex-1 overflow-y-auto'>
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
          </div>
        )}

        {tabType === TabType.lastRun && (
          <LastRun
            appId={appDetail?.id || ''}
            nodeId={id}
            canSingleRun={isSupportSingleRun}
            runningStatus={runningStatus}
            isRunAfterSingleRun={isRunAfterSingleRun}
            updateNodeRunningStatus={updateNodeRunningStatus}
            onSingleRunClicked={handleSingleRun}
            nodeInfo={nodeInfo!}
            singleRunResult={runResult!}
            isPaused={isPaused}
            {...passedLogParams}
          />
        )}
      </div>
    </div>
  )
}

export default memo(BasePanel)
