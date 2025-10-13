import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  RiCloseLine,
  RiHistoryLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStoreApi } from 'reactflow'
import {
  useNodesReadOnly,
  useWorkflowHistory,
} from '../hooks'
import TipPopup from '../operator/tip-popup'
import type { WorkflowHistoryState } from '../workflow-history-store'
import Divider from '../../base/divider'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useStore as useAppStore } from '@/app/components/app/store'
import classNames from '@/utils/classnames'

type ChangeHistoryEntry = {
  label: string
  index: number
  state: Partial<WorkflowHistoryState>
}

type ChangeHistoryList = {
  pastStates: ChangeHistoryEntry[]
  futureStates: ChangeHistoryEntry[]
  statesCount: number
}

const ViewWorkflowHistory = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { nodesReadOnly } = useNodesReadOnly()
  const { setCurrentLogItem, setShowMessageLogModal } = useAppStore(useShallow(state => ({
    appDetail: state.appDetail,
    setCurrentLogItem: state.setCurrentLogItem,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))
  const reactFlowStore = useStoreApi()
  const { store, getHistoryLabel } = useWorkflowHistory()

  const { pastStates, futureStates, undo, redo, clear } = store.temporal.getState()
  const [currentHistoryStateIndex, setCurrentHistoryStateIndex] = useState<number>(0)

  const handleClearHistory = useCallback(() => {
    clear()
    setCurrentHistoryStateIndex(0)
  }, [clear])

  const handleSetState = useCallback(({ index }: ChangeHistoryEntry) => {
    const { setEdges, setNodes } = reactFlowStore.getState()
    const diff = currentHistoryStateIndex + index
    if (diff === 0)
      return

    if (diff < 0)
      undo(diff * -1)
    else
      redo(diff)

    const { edges, nodes } = store.getState()
    if (edges.length === 0 && nodes.length === 0)
      return

    setEdges(edges)
    setNodes(nodes)
  }, [currentHistoryStateIndex, reactFlowStore, redo, store, undo])

  const calculateStepLabel = useCallback((index: number) => {
    if (!index)
      return

    const count = index < 0 ? index * -1 : index
    return `${index > 0 ? t('workflow.changeHistory.stepForward', { count }) : t('workflow.changeHistory.stepBackward', { count })}`
  }, [t])

  const calculateChangeList: ChangeHistoryList = useMemo(() => {
    const filterList = (list: any, startIndex = 0, reverse = false) => list.map((state: Partial<WorkflowHistoryState>, index: number) => {
      const nodes = (state.nodes || store.getState().nodes) || []
      const nodeId = state?.workflowHistoryEventMeta?.nodeId
      const targetTitle = nodes.find(n => n.id === nodeId)?.data?.title ?? ''
      return {
        label: state.workflowHistoryEvent && getHistoryLabel(state.workflowHistoryEvent),
        index: reverse ? list.length - 1 - index - startIndex : index - startIndex,
        state: {
          ...state,
          workflowHistoryEventMeta: state.workflowHistoryEventMeta ? {
            ...state.workflowHistoryEventMeta,
            nodeTitle: state.workflowHistoryEventMeta.nodeTitle || targetTitle,
          } : undefined,
        },
      }
    }).filter(Boolean)

    const historyData = {
      pastStates: filterList(pastStates, pastStates.length).reverse(),
      futureStates: filterList([...futureStates, (!pastStates.length && !futureStates.length) ? undefined : store.getState()].filter(Boolean), 0, true),
      statesCount: 0,
    }

    historyData.statesCount = pastStates.length + futureStates.length

    return {
      ...historyData,
      statesCount: pastStates.length + futureStates.length,
    }
  }, [futureStates, getHistoryLabel, pastStates, store])

  const composeHistoryItemLabel = useCallback((nodeTitle: string | undefined, baseLabel: string) => {
    if (!nodeTitle)
      return baseLabel
    return `${nodeTitle} ${baseLabel}`
  }, [])

  return (
    (
      <PortalToFollowElem
        placement='bottom-end'
        offset={{
          mainAxis: 4,
          crossAxis: 131,
        }}
        open={open}
        onOpenChange={setOpen}
      >
        <PortalToFollowElemTrigger onClick={() => !nodesReadOnly && setOpen(v => !v)}>
          <TipPopup
            title={t('workflow.changeHistory.title')}
          >
            <div
              className={
                classNames('flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                  open && 'bg-state-accent-active text-text-accent',
                  nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
                )}
              onClick={() => {
                if (nodesReadOnly)
                  return
                setCurrentLogItem()
                setShowMessageLogModal(false)
              }}
            >
              <RiHistoryLine className='h-4 w-4' />
            </div>
          </TipPopup>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[12]'>
          <div
            className='ml-2 flex min-w-[240px] max-w-[360px] flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-[5px]'
          >
            <div className='sticky top-0 flex items-center justify-between px-4 pt-3'>
              <div className='system-mg-regular grow text-text-secondary'>{t('workflow.changeHistory.title')}</div>
              <div
                className='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center'
                onClick={() => {
                  setCurrentLogItem()
                  setShowMessageLogModal(false)
                  setOpen(false)
                }}
              >
                <RiCloseLine className='h-4 w-4 text-text-secondary' />
              </div>
            </div>
            {
              (
                <div
                  className='overflow-y-auto p-2'
                  style={{
                    maxHeight: 'calc(1 / 2 * 100vh)',
                  }}
                >
                  {
                    !calculateChangeList.statesCount && (
                      <div className='py-12'>
                        <RiHistoryLine className='mx-auto mb-2 h-8 w-8 text-text-tertiary' />
                        <div className='text-center text-[13px] text-text-tertiary'>
                          {t('workflow.changeHistory.placeholder')}
                        </div>
                      </div>
                    )
                  }
                  <div className='flex flex-col'>
                    {
                      calculateChangeList.futureStates.map((item: ChangeHistoryEntry) => (
                        <div
                          key={item?.index}
                          className={cn(
                            'mb-0.5 flex cursor-pointer rounded-lg px-2 py-[7px] text-text-secondary hover:bg-state-base-hover',
                            item?.index === currentHistoryStateIndex && 'bg-state-base-hover',
                          )}
                          onClick={() => {
                            handleSetState(item)
                            setOpen(false)
                          }}
                        >
                          <div>
                            <div
                              className={cn(
                                'flex items-center text-[13px] font-medium leading-[18px] text-text-secondary',
                              )}
                            >
                              {composeHistoryItemLabel(
                                item?.state?.workflowHistoryEventMeta?.nodeTitle,
                                item?.label || t('workflow.changeHistory.sessionStart'),
                              )} ({calculateStepLabel(item?.index)}{item?.index === currentHistoryStateIndex && t('workflow.changeHistory.currentState')})
                            </div>
                          </div>
                        </div>
                      ))
                    }
                    {
                      calculateChangeList.pastStates.map((item: ChangeHistoryEntry) => (
                        <div
                          key={item?.index}
                          className={cn(
                            'mb-0.5 flex cursor-pointer rounded-lg px-2 py-[7px] hover:bg-state-base-hover',
                            item?.index === calculateChangeList.statesCount - 1 && 'bg-state-base-hover',
                          )}
                          onClick={() => {
                            handleSetState(item)
                            setOpen(false)
                          }}
                        >
                          <div>
                            <div
                              className={cn(
                                'flex items-center text-[13px] font-medium leading-[18px] text-text-secondary',
                              )}
                            >
                              {composeHistoryItemLabel(
                                item?.state?.workflowHistoryEventMeta?.nodeTitle,
                                item?.label || t('workflow.changeHistory.sessionStart'),
                              )} ({calculateStepLabel(item?.index)})
                            </div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )
            }
            {
              !!calculateChangeList.statesCount && (
                <div className='px-0.5'>
                  <Divider className='m-0' />
                  <div
                    className={cn(
                      'my-0.5 flex cursor-pointer rounded-lg px-2 py-[7px] text-text-secondary',
                      'hover:bg-state-base-hover',
                    )}
                    onClick={() => {
                      handleClearHistory()
                      setOpen(false)
                    }}
                  >
                    <div>
                      <div
                        className={cn(
                          'flex items-center text-[13px] font-medium leading-[18px]',
                        )}
                      >
                        {t('workflow.changeHistory.clearHistory')}
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            <div className="w-[240px] px-3 py-2 text-xs text-text-tertiary" >
              <div className="mb-1 flex h-[22px] items-center font-medium uppercase">{t('workflow.changeHistory.hint')}</div>
              <div className="mb-1 leading-[18px] text-text-tertiary">{t('workflow.changeHistory.hintText')}</div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    )
  )
}

export default memo(ViewWorkflowHistory)
