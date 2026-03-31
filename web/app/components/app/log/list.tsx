'use client'

import type { FC } from 'react'
import type { ConversationListItem, ConversationLogs, StatusCount } from './list-utils'
import type { App } from '@/types/app'
import { HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/outline'
import { RiEditFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer'
import Loading from '@/app/components/base/loading'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import Indicator from '@/app/components/header/indicator'
import useTimestamp from '@/hooks/use-timestamp'
import { cn } from '@/utils/classnames'
import { ChatConversationDetailComp, CompletionConversationDetailComp } from './list-detail-panel'
import { DEFAULT_EMPTY_VALUE, getConversationRowValues } from './list-utils'
import { useConversationDrawer } from './use-conversation-drawer'

type IConversationList = {
  logs?: ConversationLogs
  appDetail: App
  onRefresh: () => void
}

const HandThumbIconWithCount: FC<{ count: number, iconType: 'up' | 'down' }> = ({ count, iconType }) => {
  const classname = iconType === 'up' ? 'text-primary-600 bg-primary-50' : 'text-red-600 bg-red-50'
  const Icon = iconType === 'up' ? HandThumbUpIcon : HandThumbDownIcon

  return (
    <div className={`mr-1 inline-flex w-fit items-center rounded-md p-1 text-xs ${classname} last:mr-0`}>
      <Icon className="mr-0.5 h-3 w-3 rounded-md" />
      {count > 0 ? count : null}
    </div>
  )
}

const StatusCountIndicator = ({ statusCount }: { statusCount: StatusCount }) => {
  if (statusCount.paused > 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="yellow" />
        <span className="text-util-colors-warning-warning-600">Pending</span>
      </div>
    )
  }

  if (statusCount.partial_success + statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="green" />
        <span className="text-util-colors-green-green-600">Success</span>
      </div>
    )
  }

  if (statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <Indicator color="green" />
        <span className="text-util-colors-green-green-600">Partial Success</span>
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
      <Indicator color="red" />
      <span className="text-util-colors-red-red-600">
        {statusCount.failed}
        {' '}
        {statusCount.failed > 1 ? 'Failures' : 'Failure'}
      </span>
    </div>
  )
}

const TableCellValue = ({
  annotationTooltip,
  isEmptyStyle,
  isHighlight = false,
  value,
}: {
  annotationTooltip?: string
  isEmptyStyle: boolean
  isHighlight?: boolean
  value: string | number | null
}) => {
  const displayValue = value === 0 ? 0 : value || '-'
  const content = (
    <div className={cn(
      isEmptyStyle ? 'text-text-quaternary' : 'text-text-secondary',
      isHighlight && 'bg-orange-100',
      'overflow-hidden text-ellipsis whitespace-nowrap system-sm-regular',
    )}
    >
      {displayValue}
    </div>
  )

  if (!annotationTooltip)
    return content

  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipContent>
        <span className="inline-flex items-center text-xs text-text-tertiary">
          <RiEditFill className="mr-1 h-3 w-3" />
          {annotationTooltip}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

const FeedbackCounts = ({
  defaultLabel,
  dislike,
  like,
}: {
  defaultLabel: string
  dislike: number
  like: number
}) => {
  if (!like && !dislike)
    return <TableCellValue value={defaultLabel} isEmptyStyle />

  return (
    <>
      {!!like && <HandThumbIconWithCount iconType="up" count={like} />}
      {!!dislike && <HandThumbIconWithCount iconType="down" count={dislike} />}
    </>
  )
}

const ConversationList: FC<IConversationList> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const {
    activeConversationId,
    currentConversation,
    handleRowClick,
    isChatMode,
    isChatflow,
    isMobile,
    onCloseDrawer,
    showDrawer,
  } = useConversationDrawer({ appDetail, logs, onRefresh })

  if (!logs)
    return <Loading />

  return (
    <div className="relative mt-2 grow overflow-x-auto">
      <table className="w-full min-w-[440px] border-collapse border-0">
        <thead className="text-text-tertiary system-xs-medium-uppercase">
          <tr>
            <td className="w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1"></td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{isChatMode ? t('table.header.summary', { ns: 'appLog' }) : t('table.header.input', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.endUser', { ns: 'appLog' })}</td>
            {isChatflow && <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.status', { ns: 'appLog' })}</td>}
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{isChatMode ? t('table.header.messageCount', { ns: 'appLog' }) : t('table.header.output', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.userRate', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.adminRate', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.updatedTime', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3">{t('table.header.time', { ns: 'appLog' })}</td>
          </tr>
        </thead>
        <tbody className="text-text-secondary system-sm-regular">
          {logs.data.map((log: ConversationListItem) => {
            const { endUser, leftValue, rightValue } = getConversationRowValues(log, isChatMode)
            const completionAnnotation = 'annotation' in log ? log.annotation : undefined
            const statusCount = 'status_count' in (log as Record<string, unknown>) ? (log as { status_count?: StatusCount }).status_count : undefined
            const annotationTooltip = !isChatMode && completionAnnotation?.logAnnotation?.content
              ? `${t('detail.annotationTip', { ns: 'appLog', user: completionAnnotation.authorName })} ${formatTime(completionAnnotation.created_at || 0, 'MM-DD hh:mm A')}`
              : undefined

            return (
              <tr
                key={log.id}
                className={cn(
                  'cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover',
                  activeConversationId === log.id && 'bg-background-default-hover',
                )}
                onClick={() => handleRowClick(log)}
              >
                <td className="h-4">
                  {!log.read_at && (
                    <div className="flex items-center p-3 pr-0.5">
                      <span className="inline-block h-1.5 w-1.5 rounded bg-util-colors-blue-blue-500"></span>
                    </div>
                  )}
                </td>
                <td className="w-[160px] p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                  <TableCellValue
                    value={leftValue || t('table.empty.noChat', { ns: 'appLog' })}
                    isEmptyStyle={!leftValue}
                    isHighlight={isChatMode && 'annotated' in log && !!log.annotated}
                  />
                </td>
                <td className="p-3 pr-2">
                  <TableCellValue value={endUser || DEFAULT_EMPTY_VALUE} isEmptyStyle={!endUser} />
                </td>
                {isChatflow && (
                  <td className="w-[160px] p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                    {statusCount && <StatusCountIndicator statusCount={statusCount} />}
                  </td>
                )}
                <td className="p-3 pr-2" style={{ maxWidth: isChatMode ? 100 : 200 }}>
                  <TableCellValue
                    value={rightValue === 0 ? 0 : (rightValue || t('table.empty.noOutput', { ns: 'appLog' }))}
                    isEmptyStyle={!rightValue}
                    isHighlight={!isChatMode && !!completionAnnotation?.logAnnotation?.content}
                    annotationTooltip={annotationTooltip}
                  />
                </td>
                <td className="p-3 pr-2">
                  <FeedbackCounts
                    defaultLabel={DEFAULT_EMPTY_VALUE}
                    like={log.user_feedback_stats.like}
                    dislike={log.user_feedback_stats.dislike}
                  />
                </td>
                <td className="p-3 pr-2">
                  <FeedbackCounts
                    defaultLabel={DEFAULT_EMPTY_VALUE}
                    like={log.admin_feedback_stats.like}
                    dislike={log.admin_feedback_stats.dislike}
                  />
                </td>
                <td className="w-[160px] p-3 pr-2">
                  {formatTime(log.updated_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}
                </td>
                <td className="w-[160px] p-3 pr-2">
                  {formatTime(log.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassName="mt-16 mx-2 sm:mr-2 mb-4 !p-0 !max-w-[640px] rounded-xl bg-components-panel-bg"
      >
        {isChatMode
          ? <ChatConversationDetailComp appDetail={appDetail} conversationId={currentConversation?.id} onClose={onCloseDrawer} />
          : <CompletionConversationDetailComp appDetail={appDetail} conversationId={currentConversation?.id} onClose={onCloseDrawer} />}
      </Drawer>
    </div>
  )
}

export default ConversationList
