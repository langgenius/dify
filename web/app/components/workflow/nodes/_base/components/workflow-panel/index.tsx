import type { FC, ReactNode } from 'react'
import type { SimpleSubscription } from '@/app/components/plugins/plugin-detail-panel/subscription-list'
import type { Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import {
  RiCloseLine,
  RiPlayLargeLine,
} from '@remixicon/react'
import { debounce } from 'es-toolkit/compat'
import { useSetLocalStorage } from 'foxact/use-local-storage'
import * as React from 'react'
import {
  cloneElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { Stop } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useIntegrationsSetting } from '@/app/components/header/account-setting/use-integrations-setting'
import {
  AuthCategory,
  AuthorizedInDataSourceNode,
  AuthorizedInNode,
  PluginAuth,
  PluginAuthInDataSourceNode,
} from '@/app/components/plugins/plugin-auth'
import { usePluginStore } from '@/app/components/plugins/plugin-detail-panel/store'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import BlockIcon from '@/app/components/workflow/block-icon'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import {
  useAvailableBlocks,
  useNodeDataUpdate,
  useNodesInteractions,
  useNodesMetaData,
  useNodesReadOnly,
  useToolIcon,
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { NodeActionsDropdown } from '@/app/components/workflow/node-actions-menu'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useLogs } from '@/app/components/workflow/run/hooks'
import SpecialResultPanel from '@/app/components/workflow/run/special-result-panel'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import {
  canRunBySingle,
  hasErrorHandleNode,
  hasRetryNode,
  isSupportCustomRunForm,
} from '@/app/components/workflow/utils'
import { useAppContext } from '@/context/app-context'
import { useAllBuiltInTools } from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { FlowType } from '@/types/common'
import { useResizePanel } from '../../hooks/use-resize-panel'
import BeforeRunForm from '../before-run-form'
import PanelWrap from '../before-run-form/panel-wrap'
import ErrorHandleOnPanel from '../error-handle/error-handle-on-panel'
import HelpLink from '../help-link'
import NextStep from '../next-step'
import RetryOnPanel from '../retry/retry-on-panel'
import { DescriptionInput, TitleInput } from '../title-description-input'
import {
  clampNodePanelWidth,
  getCompressedNodePanelWidth,
  getCurrentDataSource,
  getCurrentToolCollection,
  getCurrentTriggerPlugin,
  getCustomRunForm,
  getMaxNodePanelWidth,
} from './helpers'
import LastRun from './last-run'
import useLastRun from './last-run/use-last-run'
import {
  StartPlaceholderPanelBody,
  StartPlaceholderPanelDescription,
  StartPlaceholderPanelTitle,
} from './start-placeholder-panel'
import { TriggerSubscription } from './trigger-subscription'
import { TabType } from './types'

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
  const language = useLanguage()
  const appId = useStore(s => s.appId)
  const { userProfile } = useAppContext()
  const { isConnected, nodePanelPresence } = useCollaboration(appId as string)
  const { showMessageLogModal } = useAppStore(useShallow(state => ({
    showMessageLogModal: state.showMessageLogModal,
  })))
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running

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

  useEffect(() => {
    if (!isConnected || !currentUserPresence.userId)
      return

    collaborationManager.emitNodePanelPresence(id, true, currentUserPresence)

    return () => {
      collaborationManager.emitNodePanelPresence(id, false, currentUserPresence)
    }
  }, [id, isConnected, currentUserPresence])

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

  const showSingleRunPanel = useStore(s => s.showSingleRunPanel)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const nodePanelWidth = useStore(s => s.nodePanelWidth)
  const otherPanelWidth = useStore(s => s.otherPanelWidth)
  const setNodePanelWidth = useStore(s => s.setNodePanelWidth)
  const pendingSingleRun = useStore(s => s.pendingSingleRun)
  const setPendingSingleRun = useStore(s => s.setPendingSingleRun)
  const setNodePanelWidthStorage = useSetLocalStorage<string>('workflow-node-panel-width', { raw: true })

  const reservedCanvasWidth = 400 // Reserve the minimum visible width for the canvas

  const maxNodePanelWidth = useMemo(
    () => getMaxNodePanelWidth(workflowCanvasWidth, otherPanelWidth, reservedCanvasWidth),
    [workflowCanvasWidth, otherPanelWidth],
  )

  const updateNodePanelWidth = useCallback((width: number, source: 'user' | 'system' = 'user') => {
    const newValue = clampNodePanelWidth(width, maxNodePanelWidth)

    if (source === 'user')
      setNodePanelWidthStorage(`${newValue}`)

    setNodePanelWidth(newValue)
  }, [maxNodePanelWidth, setNodePanelWidth, setNodePanelWidthStorage])

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
    const compressedWidth = getCompressedNodePanelWidth(nodePanelWidth, workflowCanvasWidth, otherPanelWidth, reservedCanvasWidth)
    if (compressedWidth !== undefined)
      debounceUpdate(compressedWidth)
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
    handleStop,
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

  useEffect(() => {
    if (!pendingSingleRun || pendingSingleRun.nodeId !== id)
      return

    if (pendingSingleRun.action === 'run')
      handleSingleRun()
    else
      handleStop()

    setPendingSingleRun(undefined)
  }, [pendingSingleRun, id, handleSingleRun, handleStop, setPendingSingleRun])

  const logParams = useLogs()
  const passedLogParams = useMemo(() => [BlockEnum.Tool, BlockEnum.Agent, BlockEnum.Iteration, BlockEnum.Loop].includes(data.type) ? logParams : {}, [data.type, logParams])

  const storeBuildInTools = useStore(s => s.buildInTools)
  const { data: buildInTools } = useAllBuiltInTools()
  const currToolCollection = useMemo(
    () => getCurrentToolCollection(buildInTools, storeBuildInTools, data.provider_id),
    [buildInTools, storeBuildInTools, data.provider_id],
  )
  const needsToolAuth = useMemo(() => {
    return data.type === BlockEnum.Tool && currToolCollection?.allow_delete
  }, [data.type, currToolCollection?.allow_delete])

  // only fetch trigger plugins when the node is a trigger plugin
  const { data: triggerPlugins = [] } = useAllTriggerPlugins(data.type === BlockEnum.TriggerPlugin)
  const currentTriggerPlugin = useMemo(() => getCurrentTriggerPlugin(data, triggerPlugins), [data, triggerPlugins])
  const { setDetail } = usePluginStore()

  useEffect(() => {
    if (currentTriggerPlugin) {
      setDetail({
        name: currentTriggerPlugin.label[language]!,
        plugin_id: currentTriggerPlugin.plugin_id || '',
        plugin_unique_identifier: currentTriggerPlugin.plugin_unique_identifier || '',
        id: currentTriggerPlugin.id,
        provider: currentTriggerPlugin.name,
        declaration: {
          trigger: {
            subscription_schema: currentTriggerPlugin.subscription_schema || [],
            subscription_constructor: currentTriggerPlugin.subscription_constructor,
          },
        },
      })
    }
  }, [currentTriggerPlugin, language, setDetail])

  const dataSourceList = useStore(s => s.dataSourceList)

  const currentDataSource = useMemo(() => getCurrentDataSource(data, dataSourceList), [data, dataSourceList])

  const handleAuthorizationItemClick = useCallback((credential_id: string) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        credential_id,
      },
    })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const openIntegrationsSetting = useIntegrationsSetting()

  const handleJumpToDataSourcePage = useCallback(() => {
    openIntegrationsSetting({ payload: ACCOUNT_SETTING_TAB.DATA_SOURCE })
  }, [openIntegrationsSetting])

  const {
    appendNodeInspectVars,
  } = useInspectVarsCrud()

  const handleSubscriptionChange = useCallback((v: SimpleSubscription, callback?: () => void) => {
    handleNodeDataUpdateWithSyncDraft(
      { id, data: { subscription_id: v.id } },
      {
        sync: true,
        callback: { onSettled: callback },
      },
    )
  }, [handleNodeDataUpdateWithSyncDraft, id])

  const readmeEntranceComponent = useMemo(() => {
    let pluginDetail
    switch (data.type) {
      case BlockEnum.Tool:
        pluginDetail = currToolCollection
        break
      case BlockEnum.DataSource:
        pluginDetail = currentDataSource
        break
      case BlockEnum.TriggerPlugin:
        pluginDetail = currentTriggerPlugin
        break

      default:
        break
    }
    return !pluginDetail ? null : <ReadmeEntrance pluginDetail={pluginDetail as any} className="mt-auto" />
  }, [data.type, currToolCollection, currentDataSource, currentTriggerPlugin])

  const selectedNode = useMemo(() => ({
    id,
    data,
  }) as Node, [id, data])
  if (logParams.showSpecialResultPanel) {
    return (
      <div className={cn(
        'relative mr-1 h-full',
      )}
      >
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
            <div className="h-0 grow overflow-y-auto pb-4">
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
        'relative mr-1 h-full',
      )}
      >
        <div
          ref={containerRef}
          className={cn('flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
          style={{
            width: `${nodePanelWidth}px`,
          }}
        >
          {isSupportCustomRunForm(data.type)
            ? (
                form
              )
            : (
                <BeforeRunForm
                  nodeName={data.title}
                  nodeType={data.type}
                  onHide={hideSingleRun}
                  onRun={handleRunWithParams}
                  {...singleRunParams!}
                  {...passedLogParams}
                  existVarValuesInForms={getExistVarValuesInForms(singleRunParams?.forms as any)}
                  filteredExistVarForms={getFilteredExistVarForms(singleRunParams?.forms as any)}
                  handleAfterHumanInputStepRun={handleAfterCustomSingleRun}
                />
              )}

        </div>
      </div>
    )
  }

  const runThisStepLabel = t('panel.runThisStep', { ns: 'workflow' })
  const singleRunActionLabel = isSingleRunning
    ? t('debug.variableInspect.trigger.stop', { ns: 'workflow' })
    : runThisStepLabel
  const isStartPlaceholderPanel = data.type === BlockEnum.StartPlaceholder
  const panelChildren = cloneElement(children as any, {
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
  })

  const panelTabs = (
    <TabsList>
      <TabsTab value={TabType.settings}>
        {t('debug.settingsTab', { ns: 'workflow' }).toLocaleUpperCase()}
      </TabsTab>
      <TabsTab value={TabType.lastRun}>
        {t('debug.lastRunTab', { ns: 'workflow' }).toLocaleUpperCase()}
      </TabsTab>
    </TabsList>
  )

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
        className="absolute top-0 -left-1 flex h-full w-1 cursor-col-resize resize-x items-center justify-center"
      >
        <div className="h-10 w-0.5 rounded-xs bg-state-base-handle hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid"></div>
      </div>
      <Tabs
        ref={containerRef}
        value={tabType}
        onValueChange={selectedValue => setTabType(selectedValue)}
        className={cn('flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg transition-[width] ease-linear', showSingleRunPanel ? 'overflow-hidden' : 'overflow-y-auto')}
        style={{
          width: `${nodePanelWidth}px`,
        }}
      >
        <div className="sticky top-0 z-10 shrink-0 border-b-[0.5px] border-divider-regular bg-components-panel-bg">
          <div className="flex items-center px-4 pt-4 pb-1">
            {!isStartPlaceholderPanel && (
              <BlockIcon
                className="mr-1 shrink-0"
                type={data.type}
                toolIcon={toolIcon}
                size="md"
              />
            )}
            {isStartPlaceholderPanel
              ? (
                  <StartPlaceholderPanelTitle />
                )
              : (
                  <TitleInput
                    value={data.title || ''}
                    onBlur={handleTitleBlur}
                  />
                )}
            {viewingUsers.length > 0 && (
              <div className="ml-3 shrink-0">
                <UserAvatarList
                  users={viewingUsers}
                  maxVisible={3}
                  size="sm"
                />
              </div>
            )}
            <div className="flex shrink-0 items-center text-text-tertiary">
              {
                isSupportSingleRun && !nodesReadOnly && (
                  <Tooltip disabled={isSingleRunning}>
                    <TooltipTrigger
                      render={(
                        <button
                          type="button"
                          aria-label={singleRunActionLabel}
                          className="mr-1 flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden"
                          onClick={() => {
                            if (isSingleRunning)
                              handleStop()
                            else
                              handleSingleRun()
                          }}
                        >
                          {
                            isSingleRunning
                              ? <Stop aria-hidden className="size-4 text-text-tertiary" />
                              : <RiPlayLargeLine aria-hidden className="size-4 text-text-tertiary" />
                          }
                        </button>
                      )}
                    />
                    <TooltipContent className="mr-1">
                      {runThisStepLabel}
                    </TooltipContent>
                  </Tooltip>
                )
              }
              <HelpLink nodeType={data.type} />
              <NodeActionsDropdown id={id} data={data} showHelpLink={false} />
              <div className="mx-3 h-3.5 w-px bg-divider-regular" />
              <button
                type="button"
                aria-label={t('common.operation.close')}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden"
                onClick={() => handleNodeSelect(id, true)}
              >
                <RiCloseLine aria-hidden className="size-4 text-text-tertiary" />
              </button>
            </div>
          </div>
          {isStartPlaceholderPanel
            ? (
                <StartPlaceholderPanelDescription />
              )
            : (
                <div className="p-2">
                  <DescriptionInput
                    value={data.desc || ''}
                    onChange={handleDescriptionChange}
                  />
                </div>
              )}
          {!isStartPlaceholderPanel && (
            <>
              {
                needsToolAuth && (
                  <PluginAuth
                    className="px-4 pb-2"
                    pluginPayload={{
                      provider: currToolCollection?.name || '',
                      providerType: currToolCollection?.type || '',
                      category: AuthCategory.tool,
                      detail: currToolCollection as any,
                    }}
                  >
                    <div className="flex items-center justify-between pr-3 pl-4">
                      {panelTabs}
                      <AuthorizedInNode
                        pluginPayload={{
                          provider: currToolCollection?.name || '',
                          providerType: currToolCollection?.type || '',
                          category: AuthCategory.tool,
                          detail: currToolCollection as any,
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
                    <div className="flex items-center justify-between pr-3 pl-4">
                      {panelTabs}
                      <AuthorizedInDataSourceNode
                        onJumpToDataSourcePage={handleJumpToDataSourcePage}
                        authorizationsNum={3}
                      />
                    </div>
                  </PluginAuthInDataSourceNode>
                )
              }
              {
                currentTriggerPlugin && (
                  <TriggerSubscription
                    subscriptionIdSelected={data.subscription_id}
                    onSubscriptionChange={handleSubscriptionChange}
                  >
                    {panelTabs}
                  </TriggerSubscription>
                )
              }
              {
                !needsToolAuth && !currentDataSource && !currentTriggerPlugin && (
                  <div className="flex items-center justify-between pr-3 pl-4">
                    {panelTabs}
                  </div>
                )
              }
              <Split />
            </>
          )}
        </div>

        {isStartPlaceholderPanel && (
          <StartPlaceholderPanelBody>
            {panelChildren}
          </StartPlaceholderPanelBody>
        )}

        {!isStartPlaceholderPanel && (
          <TabsPanel value={TabType.settings} className="flex flex-1 flex-col overflow-y-auto">
            <div>
              {panelChildren}
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
                <div className="border-t-[0.5px] border-divider-regular p-4">
                  <div className="mb-1 flex items-center system-sm-semibold-uppercase text-text-secondary">
                    {t('panel.nextStep', { ns: 'workflow' }).toLocaleUpperCase()}
                  </div>
                  <div className="mb-2 system-xs-regular text-text-tertiary">
                    {t('panel.addNextStep', { ns: 'workflow' })}
                  </div>
                  <NextStep selectedNode={selectedNode} />
                </div>
              )
            }
            {readmeEntranceComponent}
          </TabsPanel>
        )}

        {!isStartPlaceholderPanel && (
          <TabsPanel value={TabType.lastRun} className="flex flex-1 flex-col">
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
          </TabsPanel>
        )}

      </Tabs>
    </div>
  )
}

export default memo(BasePanel)
