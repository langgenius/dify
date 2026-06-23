import type { AgentLogConversationItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from '#i18n'
import useTimestamp from '@/hooks/use-timestamp'
import { LogSourceCell } from './source-cell'

export function AgentLogsTable({
  logs,
  isPending,
  isError,
  isSuccess,
  onRetry,
}: {
  logs: AgentLogConversationItemResponse[]
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation('agentV2')
  const tableHeaderLabels = {
    unread: t('agentDetail.logs.table.unread'),
    title: t('agentDetail.logs.table.title'),
    source: t('agentDetail.logs.table.source'),
    endUser: t('agentDetail.logs.table.endUser'),
    messageCount: t('agentDetail.logs.table.messageCount'),
    userRate: t('agentDetail.logs.table.userRate'),
    operationRate: t('agentDetail.logs.table.operationRate'),
    updatedTime: t('agentDetail.logs.table.updatedTime'),
    createdTime: t('agentDetail.logs.table.createdTime'),
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <table aria-hidden="true" className="w-full table-fixed border-collapse">
          <LogsTableColGroup />
          <LogsTableHeader labels={tableHeaderLabels} />
        </table>
      </div>

      <ScrollAreaRoot className="relative min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport
          aria-label={t('agentDetail.logs.title')}
          role="region"
          tabIndex={-1}
          className="overscroll-contain"
        >
          <ScrollAreaContent>
            <table className="w-full table-fixed border-collapse">
              <LogsTableColGroup />
              <LogsTableHeader labels={tableHeaderLabels} rowClassName="sr-only" />
              <AgentLogsTableBody
                logs={logs}
                isPending={isPending}
                isError={isError}
                isSuccess={isSuccess}
                onRetry={onRetry}
              />
            </table>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar className="data-[orientation=vertical]:translate-x-1">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </div>
  )
}

function AgentLogsTableBody({
  logs,
  isPending,
  isError,
  isSuccess,
  onRetry,
}: {
  logs: AgentLogConversationItemResponse[]
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const notAvailable = t('agentDetail.logs.notAvailable')
  const formatLogTime = (value?: number | null) =>
    value == null ? notAvailable : formatTime(value, t('roster.dateTimeFormat'))

  return (
    <tbody className="system-sm-regular text-text-secondary">
      {isPending && (
        <LogsSkeletonRows />
      )}
      {isError && (
        <LogsStateRow>
          <div className="flex items-center justify-center gap-2">
            <span>{t('agentDetail.logs.loadFailed')}</span>
            <Button variant="secondary" size="small" onClick={onRetry}>
              {tCommon('operation.retry')}
            </Button>
          </div>
        </LogsStateRow>
      )}
      {isSuccess && logs.length === 0 && (
        <LogsStateRow>
          {t('agentDetail.logs.empty')}
        </LogsStateRow>
      )}
      {isSuccess && logs.map(log => (
        <tr
          key={log.id}
          className="h-10 border-b border-divider-subtle hover:bg-background-default-hover"
        >
          <td className="px-0">
            <span className={cn(
              'mx-auto block size-1.5 rounded-full',
              log.unread ? 'bg-util-colors-blue-blue-500' : 'bg-transparent',
            )}
            />
          </td>
          <TableCell className="system-sm-medium text-text-secondary">
            {log.title || notAvailable}
          </TableCell>
          <td className="px-3">
            <LogSourceCell source={log.source} />
          </td>
          <TableCell translate="no">
            {log.end_user_id || notAvailable}
          </TableCell>
          <TableCell className="tabular-nums">
            {log.message_count}
          </TableCell>
          <TableCell className="text-text-quaternary">
            {formatRate(log.user_rate, notAvailable)}
          </TableCell>
          <TableCell className="text-text-quaternary">
            {formatRate(log.operation_rate, notAvailable)}
          </TableCell>
          <TableCell>
            {formatLogTime(log.updated_at)}
          </TableCell>
          <TableCell>
            {formatLogTime(log.created_at)}
          </TableCell>
        </tr>
      ))}
    </tbody>
  )
}

function formatRate(value: number | null | undefined, fallback: string) {
  return value == null ? fallback : `${Math.round(value * 100)}%`
}

type LogsTableHeaderLabels = {
  unread: string
  title: string
  source: string
  endUser: string
  messageCount: string
  userRate: string
  operationRate: string
  updatedTime: string
  createdTime: string
}

function LogsTableHeader({
  labels,
  rowClassName,
}: {
  labels: LogsTableHeaderLabels
  rowClassName?: string
}) {
  return (
    <thead>
      <tr className={cn('h-7 bg-background-section-burn text-left system-xs-medium-uppercase text-text-tertiary', rowClassName)}>
        <th scope="col" className="rounded-l-lg px-0">
          <span className="sr-only">{labels.unread}</span>
        </th>
        <TableHead>{labels.title}</TableHead>
        <TableHead>{labels.source}</TableHead>
        <TableHead>{labels.endUser}</TableHead>
        <TableHead>{labels.messageCount}</TableHead>
        <TableHead>{labels.userRate}</TableHead>
        <TableHead>{labels.operationRate}</TableHead>
        <TableHead>{labels.updatedTime}</TableHead>
        <TableHead className="rounded-r-lg">{labels.createdTime}</TableHead>
      </tr>
    </thead>
  )
}

function LogsTableColGroup() {
  return (
    <colgroup>
      <col className="w-5" />
      <col className="w-[28%]" />
      <col className="w-[16%]" />
      <col className="w-[15%]" />
      <col className="w-[8%]" />
      <col className="w-[7%]" />
      <col className="w-[7%]" />
      <col className="w-[10%]" />
      <col className="w-[9%]" />
    </colgroup>
  )
}

function LogsStateRow({
  children,
}: {
  children: ReactNode
}) {
  return (
    <tr className="h-20 border-b border-divider-subtle">
      <td colSpan={9} className="px-3 text-center text-text-tertiary">
        {children}
      </td>
    </tr>
  )
}

function LogsSkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }, (_, index) => (
        <tr key={index} className="h-10 border-b border-divider-subtle">
          <td className="px-0">
            <span className="mx-auto block size-1.5 rounded-full bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-3/4 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="flex items-center gap-2">
              <div className="size-5 rounded-full bg-text-quaternary opacity-20" />
              <div className="h-3 w-24 rounded-sm bg-text-quaternary opacity-20" />
            </div>
          </td>
          <td className="px-3">
            <div className="h-3 w-28 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-8 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-8 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-8 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-24 rounded-sm bg-text-quaternary opacity-20" />
          </td>
          <td className="px-3">
            <div className="h-3 w-24 rounded-sm bg-text-quaternary opacity-20" />
          </td>
        </tr>
      ))}
    </>
  )
}

function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-3 text-left whitespace-nowrap', className)}
      {...props}
    />
  )
}

function TableCell({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('min-w-0 px-3 whitespace-nowrap', className)}
      {...props}
    >
      <div className="truncate">
        {children}
      </div>
    </td>
  )
}
