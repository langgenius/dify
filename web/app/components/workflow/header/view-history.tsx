import {
  memo,
  useState,
} from 'react'
import cn from 'classnames'
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
import { WorkflowRunningStatus } from '../types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  ClockPlay,
  ClockPlaySlim,
} from '@/app/components/base/icons/src/vender/line/time'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import {
  fetcChatRunHistory,
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
  const { appDetail, setCurrentLogItem, setShowMessageLogModal } = useAppStore(useShallow(state => ({
    appDetail: state.appDetail,
    setCurrentLogItem: state.setCurrentLogItem,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleBackupDraft } = useWorkflowRun()
  const { data: runList, isLoading: runListLoading } = useSWR((appDetail && !isChatMode && open) ? `/apps/${appDetail.id}/workflow-runs` : null, fetchWorkflowRunHistory)
  const { data: chatList, isLoading: chatListLoading } = useSWR((appDetail && isChatMode && open) ? `/apps/${appDetail.id}/advanced-chat/workflow-runs` : null, fetcChatRunHistory)

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
                'flex items-center px-3 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs',
                'text-[13px] font-medium text-primary-600 cursor-pointer',
                open && '!bg-primary-50',
              )}>
                <ClockPlay
                  className={'mr-1 w-4 h-4'}
                />
                {t('workflow.common.showRunHistory')}
              </div>
            )
          }
          {
            !withText && (
              <TooltipPlus
                popupContent={t('workflow.common.viewRunHistory')}
              >
                <div
                  className={`
                    flex items-center justify-center w-7 h-7 rounded-md hover:bg-black/5 cursor-pointer
                    ${open && 'bg-primary-50'}
                  `}
                  onClick={() => {
                    setCurrentLogItem()
                    setShowMessageLogModal(false)
                  }}
                >
                  <ClockPlay className={`w-4 h-4 ${open ? 'text-primary-600' : 'text-gray-500'}`} />
                </div>
              </TooltipPlus>
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[12]'>
          <div
            className='flex flex-col ml-2 w-[240px] bg-white border-[0.5px] border-gray-200 shadow-xl rounded-xl overflow-y-auto'
            style={{
              maxHeight: 'calc(2 / 3 * 100vh)',
            }}
          >
            <div className='sticky top-0 bg-white flex items-center justify-between px-4 pt-3 text-base font-semibold text-gray-900'>
              <div className='grow'>{t('workflow.common.runHistory')}</div>
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
              isLoading && (
                <div className='flex items-center justify-center h-10'>
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
                        <ClockPlaySlim className='mx-auto mb-2 w-8 h-8 text-gray-300' />
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
                          'flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer',
                          item.id === historyWorkflowData?.id && 'bg-primary-50',
                        )}
                        onClick={() => {
                          workflowStore.setState({
                            historyWorkflowData: item,
                            showInputsPanel: false,
                          })
                          handleBackupDraft()
                          setOpen(false)
                          handleNodesCancelSelected()
                          handleCancelDebugAndPreviewPanel()
                        }}
                      >
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Stopped && (
                            <AlertTriangle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#F79009]' />
                          )
                        }
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Failed && (
                            <RiErrorWarningLine className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#F04438]' />
                          )
                        }
                        {
                          !isChatMode && item.status === WorkflowRunningStatus.Succeeded && (
                            <RiCheckboxCircleLine className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#12B76A]' />
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
                          <div className='flex items-center text-xs text-gray-500 leading-[18px]'>
                            {item.created_by_account.name} · {formatTimeFromNow((item.finished_at || item.created_at) * 1000)}
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
