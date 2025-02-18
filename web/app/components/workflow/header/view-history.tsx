import {
  memo,
  useState,
} from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
} from '@remixicon/react'
import {
  useIsChatMode,
  useNodesInteractions,
  useWorkflow,
  useWorkflowInteractions,
  useWorkflowRun,
} from '../hooks'
import { ControlMode, WorkflowRunningStatus } from '../types'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Tooltip from '@/app/components/base/tooltip'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  ClockPlay,
  ClockPlaySlim,
} from '@/app/components/base/icons/src/vender/line/time'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import {
  fetchChatRunHistory,
  fetchWorkflowRunHistory,
} from '@/service/workflow'
import Loading from '@/app/components/base/loading'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'

type ViewHistoryProps = {
  withText?: boolean
}
const ViewHistory = ({
  withText,
}: ViewHistoryProps) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const [open, setOpen] = useState(false)
  const { formatTimeFromNow } = useWorkflow()
  const {
    handleNodesCancelSelected,
  } = useNodesInteractions()
  const {
    handleCancelDebugAndPreviewPanel,
  } = useWorkflowInteractions()
  const workflowStore = useWorkflowStore()
  const setControlMode = useStore(s => s.setControlMode)
  const { appDetail, setCurrentLogItem, setShowMessageLogModal } = useAppStore(useShallow(state => ({
    appDetail: state.appDetail,
    setCurrentLogItem: state.setCurrentLogItem,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleBackupDraft } = useWorkflowRun()
  const { data: runList, isLoading: runListLoading } = useSWR((appDetail && !isChatMode && open) ? `/apps/${appDetail.id}/workflow-runs` : null, fetchWorkflowRunHistory)
  const { data: chatList, isLoading: chatListLoading } = useSWR((appDetail && isChatMode && open) ? `/apps/${appDetail.id}/advanced-chat/workflow-runs` : null, fetchChatRunHistory)

  const data = isChatMode ? chatList : runList
  const isLoading = isChatMode ? chatListLoading : runListLoading

  return (
    (
      <PortalToFollowElem
        placement={withText ? 'bottom-start' : 'bottom-end'}
        offset={{
          mainAxis: 4,
          crossAxis: withText ? -8 : 10,
        }}
        open={open}
        onOpenChange={setOpen}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          {
            withText && (
              <div className={cn(
                'shadow-xs flex h-8 items-center rounded-lg border-[0.5px] border-gray-200 bg-white px-3',
                'text-primary-600 cursor-pointer text-[13px] font-medium',
                open && '!bg-primary-50',
              )}>
                <ClockPlay
                  className={'mr-1 h-4 w-4'}
                />
                {t('workflow.common.showRunHistory')}
              </div>
            )
          }
          {
            !withText && (
              <Tooltip
                popupContent={t('workflow.common.viewRunHistory')}
              >
                <div
                  className={cn('hover:bg-state-accent-hover group flex h-7 w-7 cursor-pointer items-center justify-center rounded-md', open && 'bg-state-accent-hover')}
                  onClick={() => {
                    setCurrentLogItem()
                    setShowMessageLogModal(false)
                  }}
                >
                  <ClockPlay className={cn('group-hover:text-components-button-secondary-accent-text h-4 w-4', open ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text')} />
                </div>
              </Tooltip>
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[12]'>
          <div
            className='ml-2 flex w-[240px] flex-col overflow-y-auto rounded-xl border-[0.5px] border-gray-200 bg-white shadow-xl'
            style={{
              maxHeight: 'calc(2 / 3 * 100vh)',
            }}
          >
            <div className='sticky top-0 flex items-center justify-between bg-white px-4 pt-3 text-base font-semibold text-gray-900'>
              <div className='grow'>{t('workflow.common.runHistory')}</div>
              <div
                className='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center'
                onClick={() => {
                  setCurrentLogItem()
                  setShowMessageLogModal(false)
                  setOpen(false)
                }}
              >
                <RiCloseLine className='h-4 w-4 text-gray-500' />
              </div>
            </div>
            {
              isLoading && (
                <div className='flex h-10 items-center justify-center'>
                  <Loading />
                </div>
              )
            }
            {
              !isLoading && (
                <div className='p-2'>
                  {
                    !data?.data.length && (
                      <div className='py-12'>
                        <ClockPlaySlim className='mx-auto mb-2 h-8 w-8 text-gray-300' />
                        <div className='text-center text-[13px] text-gray-400'>
                          {t('workflow.common.notRunning')}
                        </div>
                      </div>
                    )
                  }
                  {
                    data?.data.map(item => (
                      <div
                        key={item.id}
                        className={cn(
                          'hover:bg-primary-50 mb-0.5 flex cursor-pointer rounded-lg px-2 py-[7px]',
                          item.id === historyWorkflowData?.id && 'bg-primary-50',
                        )}
                        onClick={() => {
                          workflowStore.setState({
                            historyWorkflowData: item,
                            showInputsPanel: false,
                            showEnvPanel: false,
                          })
                          handleBackupDraft()
                          setOpen(false)
                          handleNodesCancelSelected()
                          handleCancelDebugAndPreviewPanel()
                          setControlMode(ControlMode.Hand)
                        }}
                      >
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Stopped && (
                            <AlertTriangle className='mr-1.5 mt-0.5 h-3.5 w-3.5 text-[#F79009]' />
                          )
                        }
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Failed && (
                            <RiErrorWarningLine className='mr-1.5 mt-0.5 h-3.5 w-3.5 text-[#F04438]' />
                          )
                        }
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Succeeded && (
                            <RiCheckboxCircleLine className='mr-1.5 mt-0.5 h-3.5 w-3.5 text-[#12B76A]' />
                          )
                        }
                        <div>
                          <div
                            className={cn(
                              'flex items-center text-[13px] font-medium leading-[18px]',
                              item.id === historyWorkflowData?.id && 'text-primary-600',
                            )}
                          >
                            {`Test ${isChatMode ? 'Chat' : 'Run'}#${item.sequence_number}`}
                          </div>
                          <div className='flex items-center text-xs leading-[18px] text-gray-500'>
                            {item.created_by_account?.name} · {formatTimeFromNow((item.finished_at || item.created_at) * 1000)}
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )
            }
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    )
  )
}

export default memo(ViewHistory)
