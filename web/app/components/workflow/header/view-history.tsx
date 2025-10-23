import {
  memo,
  useState,
} from 'react'
import type { Fetcher } from 'swr'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { noop } from 'lodash-es'
import {
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
} from '@remixicon/react'
import {
  useIsChatMode,
  useNodesInteractions,
  useWorkflowInteractions,
  useWorkflowRun,
} from '../hooks'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { ControlMode, WorkflowRunningStatus } from '../types'
import { formatWorkflowRunIdentifier } from '../utils'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Tooltip from '@/app/components/base/tooltip'
import {
  ClockPlay,
  ClockPlaySlim,
} from '@/app/components/base/icons/src/vender/line/time'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import Loading from '@/app/components/base/loading'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import type { WorkflowRunHistoryResponse } from '@/types/workflow'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'

export type ViewHistoryProps = {
  withText?: boolean
  onClearLogAndMessageModal?: () => void
  historyUrl?: string
  historyFetcher?: Fetcher<WorkflowRunHistoryResponse, string>
}
const ViewHistory = ({
  withText,
  onClearLogAndMessageModal,
  historyUrl,
  historyFetcher,
}: ViewHistoryProps) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const [open, setOpen] = useState(false)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const {
    handleNodesCancelSelected,
  } = useNodesInteractions()
  const {
    handleCancelDebugAndPreviewPanel,
  } = useWorkflowInteractions()
  const workflowStore = useWorkflowStore()
  const setControlMode = useStore(s => s.setControlMode)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleBackupDraft } = useWorkflowRun()
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const fetcher = historyFetcher ?? (noop as Fetcher<WorkflowRunHistoryResponse, string>)
  const {
    data,
    isLoading,
  } = useSWR((open && historyUrl && historyFetcher) ? historyUrl : null, fetcher)

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
                'flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 shadow-xs',
                'cursor-pointer text-[13px] font-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover',
                open && 'bg-components-button-secondary-bg-hover',
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
                  className={cn('group flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-state-accent-hover', open && 'bg-state-accent-hover')}
                  onClick={() => {
                    onClearLogAndMessageModal?.()
                  }}
                >
                  <ClockPlay className={cn('h-4 w-4 group-hover:text-components-button-secondary-accent-text', open ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text')} />
                </div>
              </Tooltip>
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[12]'>
          <div
            className='ml-2 flex w-[240px] flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'
            style={{
              maxHeight: 'calc(2 / 3 * 100vh)',
            }}
          >
            <div className='sticky top-0 flex items-center justify-between bg-components-panel-bg px-4 pt-3 text-base font-semibold text-text-primary'>
              <div className='grow'>{t('workflow.common.runHistory')}</div>
              <div
                className='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center'
                onClick={() => {
                  onClearLogAndMessageModal?.()
                  setOpen(false)
                }}
              >
                <RiCloseLine className='h-4 w-4 text-text-tertiary' />
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
                        <ClockPlaySlim className='mx-auto mb-2 h-8 w-8 text-text-quaternary' />
                        <div className='text-center text-[13px] text-text-quaternary'>
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
                          'mb-0.5 flex cursor-pointer rounded-lg px-2 py-[7px] hover:bg-state-base-hover',
                          item.id === historyWorkflowData?.id && 'bg-state-accent-hover hover:bg-state-accent-hover',
                        )}
                        onClick={() => {
                          workflowStore.setState({
                            historyWorkflowData: item,
                            showInputsPanel: false,
                            showEnvPanel: false,
                          })
                          closeAllInputFieldPanels()
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
                              'flex items-center text-[13px] font-medium leading-[18px] text-text-primary',
                              item.id === historyWorkflowData?.id && 'text-text-accent',
                            )}
                          >
                            {`Test ${isChatMode ? 'Chat' : 'Run'}${formatWorkflowRunIdentifier(item.finished_at)}`}
                          </div>
                          <div className='flex items-center text-xs leading-[18px] text-text-tertiary'>
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
