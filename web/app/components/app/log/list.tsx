'use client'

import type {
  AppDetailWithSite,
  Conversation,
  ConversationAnnotation,
  ConversationPagination,
  ConversationWithSummary,
  ConversationWithSummaryPagination,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/outline'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTrigger,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiEditFill } from '@remixicon/react'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { parseAsString, useQueryState } from 'nuqs'
import { Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useTimestamp from '@/hooks/use-timestamp'
import { ConversationDetail } from './conversation-detail'
import EmptyElement from './empty-element'
import { getConversationRowValues } from './list-utils'
import { LogListSkeleton } from './loading'

type ConversationListItem = ConversationWithSummary | Conversation

dayjs.extend(utc)
dayjs.extend(timezone)

type IConversationList = {
  logs?: ConversationWithSummaryPagination | ConversationPagination
  appDetail: AppDetailWithSite
  onRefresh: () => void
}

const defaultValue = 'N/A'

type StatusCount = {
  paused: number
  success: number
  failed: number
  partial_success: number
}

/**
 * Icon component with numbers
 */
const HandThumbIconWithCount: FC<{ count: number; iconType: 'up' | 'down' }> = ({
  count,
  iconType,
}) => {
  const classname = iconType === 'up' ? 'text-primary-600 bg-primary-50' : 'text-red-600 bg-red-50'
  const Icon = iconType === 'up' ? HandThumbUpIcon : HandThumbDownIcon
  return (
    <div
      className={`inline-flex w-fit items-center rounded-md p-1 text-xs ${classname} mr-1 last:mr-0`}
    >
      <Icon className="mr-0.5 size-3 rounded-md" />
      {count > 0 ? count : null}
    </div>
  )
}

const statusTdRender = (statusCount: StatusCount | null | undefined) => {
  if (!statusCount) return null

  if (statusCount.paused > 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <StatusDot status="warning" />
        <span className="text-util-colors-warning-warning-600">Pending</span>
      </div>
    )
  } else if (statusCount.partial_success + statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <StatusDot status="success" />
        <span className="text-util-colors-green-green-600">Success</span>
      </div>
    )
  } else if (statusCount.failed === 0) {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <StatusDot status="success" />
        <span className="text-util-colors-green-green-600">Partial Success</span>
      </div>
    )
  } else {
    return (
      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
        <StatusDot status="error" />
        <span className="text-util-colors-red-red-600">
          {statusCount.failed} {`${statusCount.failed > 1 ? 'Failures' : 'Failure'}`}
        </span>
      </div>
    )
  }
}

/**
 * Conversation list component including basic information
 */
const ConversationList: FC<IConversationList> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation(['appLog'])
  const { formatTime } = useTimestamp()
  const [conversationIdInUrl, setConversationIdInUrl] = useQueryState(
    'conversation_id',
    parseAsString,
  )

  const popupRef = useRef<HTMLDivElement>(null)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const isChatMode = appDetail.mode !== 'completion'
  const isChatflow = appDetail.mode === 'advanced-chat'
  const activeConversationId = conversationIdInUrl
  const handleRowClick = (log: ConversationListItem) => {
    void setConversationIdInUrl(log.id, { history: 'push' })
  }
  const onCloseDialog = () => {
    onRefresh()
    void setConversationIdInUrl(null, { history: 'replace' })
  }

  // Annotated data needs to be highlighted
  const renderTdValue = (
    value: string | number | null,
    isEmptyStyle: boolean,
    isHighlight = false,
    annotation?: ConversationAnnotation | null,
  ) => {
    return (
      <Tooltip disabled={!isHighlight || isChatMode}>
        <TooltipTrigger
          render={
            <div
              className={cn(
                isEmptyStyle ? 'text-text-quaternary' : 'text-text-secondary',
                !isHighlight ? '' : 'bg-orange-100',
                'truncate system-sm-regular',
              )}
            >
              {value || '-'}
            </div>
          }
        />
        <TooltipContent className="flex items-center gap-1">
          <RiEditFill aria-hidden className="size-3 shrink-0" />
          <span>
            {`${t(($) => $['detail.annotationTip'], { ns: 'appLog', user: annotation?.account?.name ?? '-' })} ${formatTime(annotation?.created_at || dayjs().unix(), 'MM-DD hh:mm A')}`}
          </span>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="relative mt-2 grow overflow-x-auto">
      <Dialog
        open={!!conversationIdInUrl}
        modal
        onOpenChange={(open) => {
          if (!open) onCloseDialog()
        }}
      >
        <table className="w-full min-w-300 table-fixed border-collapse border-0">
          <colgroup>
            <col className="w-5" />
            <col />
            <col />
            {isChatflow && <col className="w-36" />}
            <col className={isChatMode ? 'w-28' : undefined} />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-40" />
            <col className="w-40" />
          </colgroup>
          <thead className="system-xs-medium-uppercase text-text-tertiary">
            <tr>
              <td className="w-5 rounded-l-lg bg-background-section-burn pr-1 pl-2 whitespace-nowrap"></td>
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {isChatMode
                  ? t(($) => $['table.header.summary'], { ns: 'appLog' })
                  : t(($) => $['table.header.input'], { ns: 'appLog' })}
              </th>
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {t(($) => $['table.header.endUser'], { ns: 'appLog' })}
              </th>
              {isChatflow && (
                <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.status'], { ns: 'appLog' })}
                </th>
              )}
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {isChatMode
                  ? t(($) => $['table.header.messageCount'], { ns: 'appLog' })
                  : t(($) => $['table.header.output'], { ns: 'appLog' })}
              </th>
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {t(($) => $['table.header.userRate'], { ns: 'appLog' })}
              </th>
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {t(($) => $['table.header.adminRate'], { ns: 'appLog' })}
              </th>
              <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {t(($) => $['table.header.updatedTime'], { ns: 'appLog' })}
              </th>
              <th className="rounded-r-lg bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                {t(($) => $['table.header.time'], { ns: 'appLog' })}
              </th>
            </tr>
          </thead>
          <tbody className="system-sm-regular text-text-secondary">
            <Suspense fallback={<LogListSkeleton columns={isChatflow ? 9 : 8} />}>
              {!logs ? (
                <LogListSkeleton columns={isChatflow ? 9 : 8} />
              ) : logs.total === 0 ? (
                <tr>
                  <td colSpan={isChatflow ? 9 : 8} className="h-80">
                    <EmptyElement appDetail={appDetail} />
                  </td>
                </tr>
              ) : (
                logs.data.map((log) => {
                  const { endUser, isLeftEmpty, isRightEmpty, leftValue, rightValue } =
                    getConversationRowValues({
                      isChatMode,
                      log,
                      noChatLabel: t(($) => $['table.empty.noChat'], { ns: 'appLog' }),
                      noOutputLabel: t(($) => $['table.empty.noOutput'], { ns: 'appLog' }),
                    })
                  return (
                    <tr
                      key={log.id}
                      className={cn(
                        'cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover',
                        activeConversationId !== log.id ? '' : 'bg-background-default-hover',
                      )}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button, a')) return
                        event.currentTarget
                          .querySelector<HTMLButtonElement>('button[data-log-detail-trigger]')
                          ?.click()
                      }}
                    >
                      <td className="h-4">
                        {!log.read_at && (
                          <div className="flex items-center p-3 pr-0.5">
                            <span
                              aria-hidden="true"
                              className="inline-block size-1.5 rounded-sm bg-util-colors-blue-blue-500"
                            ></span>
                            <span className="sr-only">
                              {t(($) => $['table.unread'], { ns: 'appLog' })}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="w-40 p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                        {renderTdValue(
                          leftValue,
                          isLeftEmpty,
                          isChatMode && 'annotated' in log && log.annotated,
                        )}
                      </td>
                      <td className="p-3 pr-2">
                        {renderTdValue(endUser || defaultValue, !endUser)}
                      </td>
                      {isChatflow && (
                        <td className="w-40 p-3 pr-2" style={{ maxWidth: isChatMode ? 300 : 200 }}>
                          {statusTdRender('status_count' in log ? log.status_count : undefined)}
                        </td>
                      )}
                      <td className="p-3 pr-2" style={{ maxWidth: isChatMode ? 100 : 200 }}>
                        {renderTdValue(
                          rightValue,
                          isRightEmpty,
                          !isChatMode && 'annotation' in log && !!log.annotation?.content,
                          'annotation' in log ? log.annotation : undefined,
                        )}
                      </td>
                      <td className="p-3 pr-2">
                        {!log.user_feedback_stats?.like && !log.user_feedback_stats?.dislike ? (
                          renderTdValue(defaultValue, true)
                        ) : (
                          <>
                            {!!log.user_feedback_stats?.like && (
                              <HandThumbIconWithCount
                                iconType="up"
                                count={log.user_feedback_stats.like}
                              />
                            )}
                            {!!log.user_feedback_stats?.dislike && (
                              <HandThumbIconWithCount
                                iconType="down"
                                count={log.user_feedback_stats.dislike}
                              />
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-3 pr-2">
                        {!log.admin_feedback_stats?.like && !log.admin_feedback_stats?.dislike ? (
                          renderTdValue(defaultValue, true)
                        ) : (
                          <>
                            {!!log.admin_feedback_stats?.like && (
                              <HandThumbIconWithCount
                                iconType="up"
                                count={log.admin_feedback_stats.like}
                              />
                            )}
                            {!!log.admin_feedback_stats?.dislike && (
                              <HandThumbIconWithCount
                                iconType="down"
                                count={log.admin_feedback_stats.dislike}
                              />
                            )}
                          </>
                        )}
                      </td>
                      <td className="w-40 p-3 pr-2">
                        {log.updated_at
                          ? formatTime(
                              log.updated_at,
                              t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                            )
                          : defaultValue}
                      </td>
                      <td className="w-40 p-3 pr-2">
                        <DialogTrigger
                          data-log-detail-trigger
                          className="w-full cursor-pointer rounded-sm text-left"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRowClick(log)
                          }}
                        >
                          {log.created_at
                            ? formatTime(
                                log.created_at,
                                t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                              )
                            : defaultValue}
                        </DialogTrigger>
                      </td>
                    </tr>
                  )
                })
              )}
            </Suspense>
          </tbody>
        </table>
        <DialogPortal>
          <DialogBackdrop className={cn(!isMobile && 'bg-transparent')} />
          <DialogViewport>
            <DialogPopup
              ref={popupRef}
              initialFocus={popupRef}
              className="fixed top-16 right-2 bottom-4 flex w-full max-w-160 flex-col overflow-hidden rounded-xl bg-components-panel-bg shadow-xl outline-hidden"
            >
              <div className="flex min-h-0 flex-1 flex-col">
                <ConversationSession
                  appDetail={appDetail}
                  conversationId={conversationIdInUrl}
                  onClose={onCloseDialog}
                />
              </div>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
    </div>
  )
}

export default ConversationList

function ConversationSession({
  appDetail,
  conversationId,
  onClose,
}: {
  appDetail: AppDetailWithSite
  conversationId: string | null
  onClose: () => void
}) {
  // Keep the closing conversation mounted until the Dialog finishes its exit transition.
  const [sessionId, setSessionId] = useState(conversationId)
  if (conversationId && conversationId !== sessionId) setSessionId(conversationId)
  return sessionId ? (
    <ConversationDetail
      key={sessionId}
      appDetail={appDetail}
      conversationId={sessionId}
      onClose={onClose}
    />
  ) : null
}
