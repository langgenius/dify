import type { WorkflowHistoryState } from '../store/workflow/history-slice'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiCloseLine,
  RiHistoryLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Divider from '../../base/divider'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import {
  useNodesReadOnly,
  useWorkflowHistory,
} from '../hooks'
import { useCollaborativeWorkflow } from '../hooks/use-collaborative-workflow'
import TipPopup from '../operator/tip-popup'

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
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { store, getHistoryLabel } = useWorkflowHistory()

  const { pastStates, futureStates, undo, redo, clear } = store.temporal.getState()
  const [currentHistoryStateIndex, setCurrentHistoryStateIndex] = useState<number>(0)

  const handleClearHistory = useCallback(() => {
    clear()
    setCurrentHistoryStateIndex(0)
  }, [clear])

  const handleSetState = useCallback(({ index }: ChangeHistoryEntry) => {
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

    const shouldBroadcast = collaborationManager.isConnected()
    const { setEdges, setNodes } = collaborativeWorkflow.getState()
    setEdges(edges, shouldBroadcast)
    setNodes(nodes, shouldBroadcast, 'history:jump')
    if (collaborationManager.isConnected())
      collaborationManager.emitHistoryAction('jump')
  }, [collaborativeWorkflow, currentHistoryStateIndex, redo, store, undo])

  const calculateStepLabel = useCallback((index: number) => {
    if (!index)
      return

    const count = index < 0 ? index * -1 : index
    return `${index > 0 ? t('changeHistory.stepForward', { ns: 'workflow', count }) : t('changeHistory.stepBackward', { ns: 'workflow', count })}`
  }, [t])

  const calculateChangeList: ChangeHistoryList = useMemo(() => {
    const filterList = (
      list: Array<Partial<WorkflowHistoryState> | undefined>,
      startIndex = 0,
      reverse = false,
    ) => list.flatMap((state, index) => {
      if (!state)
        return []

      const nodes = state.nodes || store.getState().nodes || []
      const nodeId = state.workflowHistoryEventMeta?.nodeId
      const targetTitle = nodes.find(n => n.id === nodeId)?.data?.title ?? ''

      return [{
        label: state.workflowHistoryEvent ? getHistoryLabel(state.workflowHistoryEvent) : '',
        index: reverse ? list.length - 1 - index - startIndex : index - startIndex,
        state: {
          ...state,
          workflowHistoryEventMeta: state.workflowHistoryEventMeta
            ? {
                ...state.workflowHistoryEventMeta,
                nodeTitle: state.workflowHistoryEventMeta.nodeTitle || targetTitle,
              }
            : undefined,
        },
      }]
    })

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
      <Popover
        modal="trap-focus"
        open={open}
        onOpenChange={(nextOpen) => {
          if (nodesReadOnly)
            return
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          render={(
            <button
              type="button"
              aria-label={t('changeHistory.title', { ns: 'workflow' })}
              disabled={nodesReadOnly}
              className={
                cn('box-border inline-flex h-8 max-h-8 min-h-8 w-8 max-w-8 min-w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md p-0 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', open && 'bg-state-accent-active text-text-accent', nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')
              }
              onClick={() => {
                if (nodesReadOnly)
                  return
                setCurrentLogItem()
                setShowMessageLogModal(false)
              }}
            >
              <TipPopup
                title={t('changeHistory.title', { ns: 'workflow' })}
              >
                <span className="flex h-full w-full shrink-0 items-center justify-center">
                  <span className="i-ri-history-line h-4 w-4 shrink-0" />
                </span>
              </TipPopup>
            </button>
          )}
        />
        <PopoverContent
          placement="bottom-end"
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div
            className="flex max-w-[360px] min-w-[240px] flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-[5px]"
          >
            <div className="sticky top-0 flex items-center justify-between px-4 pt-3">
              <div className="system-mg-regular grow text-text-secondary">{t('changeHistory.title', { ns: 'workflow' })}</div>
              <PopoverClose
                render={(
                  <button
                    type="button"
                    aria-label={t('operation.close', { ns: 'common' })}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center"
                  >
                    <RiCloseLine className="h-4 w-4 text-text-secondary" />
                  </button>
                )}
                onClick={() => {
                  setCurrentLogItem()
                  setShowMessageLogModal(false)
                }}
              />
            </div>
            <div
              className="overflow-y-auto p-2"
              style={{
                maxHeight: 'calc(1 / 2 * 100vh)',
              }}
            >
              {
                !calculateChangeList.statesCount && (
                  <div className="py-12">
                    <RiHistoryLine className="mx-auto mb-2 h-8 w-8 text-text-tertiary" />
                    <div className="text-center text-[13px] text-text-tertiary">
                      {t('changeHistory.placeholder', { ns: 'workflow' })}
                    </div>
                  </div>
                )
              }
              <div className="flex flex-col">
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
                            'flex items-center text-[13px] leading-[18px] font-medium text-text-secondary',
                          )}
                        >
                          {composeHistoryItemLabel(
                            item?.state?.workflowHistoryEventMeta?.nodeTitle,
                            item?.label || t('changeHistory.sessionStart', { ns: 'workflow' }),
                          )}
                          {' '}
                          (
                          {calculateStepLabel(item?.index)}
                          {item?.index === currentHistoryStateIndex && t('changeHistory.currentState', { ns: 'workflow' })}
                          )
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
                            'flex items-center text-[13px] leading-[18px] font-medium text-text-secondary',
                          )}
                        >
                          {composeHistoryItemLabel(
                            item?.state?.workflowHistoryEventMeta?.nodeTitle,
                            item?.label || t('changeHistory.sessionStart', { ns: 'workflow' }),
                          )}
                          {' '}
                          (
                          {calculateStepLabel(item?.index)}
                          )
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
            {
              !!calculateChangeList.statesCount && (
                <div className="px-0.5">
                  <Divider className="m-0" />
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
                          'flex items-center text-[13px] leading-[18px] font-medium',
                        )}
                      >
                        {t('changeHistory.clearHistory', { ns: 'workflow' })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            <div className="w-[240px] px-3 py-2 text-xs text-text-tertiary">
              <div className="mb-1 flex h-[22px] items-center font-medium uppercase">{t('changeHistory.hint', { ns: 'workflow' })}</div>
              <div className="mb-1 leading-[18px] text-text-tertiary">{t('changeHistory.hintText', { ns: 'workflow' })}</div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  )
}

export default memo(ViewWorkflowHistory)
