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
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useStore as useAppStore } from '@/app/components/app/store'

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
  const reactflowStore = useStoreApi()
  const { store, getHistoryLabel } = useWorkflowHistory()

  const { pastStates, futureStates, undo, redo, clear } = store.temporal.getState()
  const [currentHistoryStateIndex, setCurrentHistoryStateIndex] = useState<number>(0)

  const handleClearHistory = useCallback(() => {
    clear()
    setCurrentHistoryStateIndex(0)
  }, [clear])

  const handleSetState = useCallback(({ index }: ChangeHistoryEntry) => {
    const { setEdges, setNodes } = reactflowStore.getState()
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
  }, [currentHistoryStateIndex, reactflowStore, redo, store, undo])

  const calculateStepLabel = useCallback((index: number) => {
    if (!index)
      return

    const count = index < 0 ? index * -1 : index
    return `${index > 0 ? t('workflow.changeHistory.stepForward', { count }) : t('workflow.changeHistory.stepBackward', { count })}`
  }
  , [t])

  const calculateChangeList: ChangeHistoryList = useMemo(() => {
    const filterList = (list: any, startIndex = 0, reverse = false) => list.map((state: Partial<WorkflowHistoryState>, index: number) => {
      return {
        label: state.workflowHistoryEvent && getHistoryLabel(state.workflowHistoryEvent),
        index: reverse ? list.length - 1 - index - startIndex : index - startIndex,
        state,
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
              className={`
                flex items-center justify-center w-8 h-8 rounded-md hover:bg-black/5 cursor-pointer
                ${open && 'bg-primary-50'} ${nodesReadOnly && 'bg-primary-50 opacity-50 !cursor-not-allowed'}
              `}
              onClick={() => {
                if (nodesReadOnly)
                  return
                setCurrentLogItem()
                setShowMessageLogModal(false)
              }}
            >
              <RiHistoryLine className={`w-4 h-4 hover:bg-black/5 hover:text-gray-700 ${open ? 'text-primary-600' : 'text-gray-500'}`} />
            </div>
          </TipPopup>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[12]'>
          <div
            className='flex flex-col ml-2 min-w-[240px] max-w-[360px] bg-white border-[0.5px] border-gray-200 shadow-xl rounded-xl overflow-y-auto'
          >
            <div className='sticky top-0 bg-white flex items-center justify-between px-4 pt-3 text-base font-semibold text-gray-900'>
              <div className='grow'>{t('workflow.changeHistory.title')}</div>
              <div
                className='shrink-0 flex items-center justify-center w-6 h-6 cursor-pointer'
                onClick={() => {
                  setCurrentLogItem()
                  setShowMessageLogModal(false)
                  setOpen(false)
                }}
              >
                <RiCloseLine className='w-4 h-4 text-gray-500' />
              </div>
            </div>
            {
              (
                <div
                  className='p-2 overflow-y-auto'
                  style={{
                    maxHeight: 'calc(1 / 2 * 100vh)',
                  }}
                >
                  {
                    !calculateChangeList.statesCount && (
                      <div className='py-12'>
                        <RiHistoryLine className='mx-auto mb-2 w-8 h-8 text-gray-300' />
                        <div className='text-center text-[13px] text-gray-400'>
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
                            'flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer',
                            item?.index === currentHistoryStateIndex && 'bg-primary-50',
                          )}
                          onClick={() => {
                            handleSetState(item)
                            setOpen(false)
                          }}
                        >
                          <div>
                            <div
                              className={cn(
                                'flex items-center text-[13px] font-medium leading-[18px]',
                                item?.index === currentHistoryStateIndex && 'text-primary-600',
                              )}
                            >
                              {item?.label || t('workflow.changeHistory.sessionStart')} ({calculateStepLabel(item?.index)}{item?.index === currentHistoryStateIndex && t('workflow.changeHistory.currentState')})
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
                            'flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer',
                            item?.index === calculateChangeList.statesCount - 1 && 'bg-primary-50',
                          )}
                          onClick={() => {
                            handleSetState(item)
                            setOpen(false)
                          }}
                        >
                          <div>
                            <div
                              className={cn(
                                'flex items-center text-[13px] font-medium leading-[18px]',
                                item?.index === calculateChangeList.statesCount - 1 && 'text-primary-600',
                              )}
                            >
                              {item?.label || t('workflow.changeHistory.sessionStart')} ({calculateStepLabel(item?.index)})
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
                <>
                  <div className="h-[1px] bg-gray-100" />
                  <div
                    className={cn(
                      'flex my-0.5 px-2 py-[7px] rounded-lg cursor-pointer',
                      'hover:bg-red-50 hover:text-red-600',
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
                </>
              )
            }
            <div className="px-3 w-[240px] py-2 text-xs text-gray-500" >
              <div className="flex items-center mb-1 h-[22px] font-medium uppercase">{t('workflow.changeHistory.hint')}</div>
              <div className="mb-1 text-gray-700 leading-[18px]">{t('workflow.changeHistory.hintText')}</div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    )
  )
}

export default memo(ViewWorkflowHistory)
