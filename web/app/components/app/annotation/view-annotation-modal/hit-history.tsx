import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { APP_PAGE_LIMIT } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import HitHistoryNoData from './hit-history-no-data'

type AnnotationHitHistoryProps = { appId: string; annotationId: string }

export function AnnotationHitHistory({ appId, annotationId }: AnnotationHitHistoryProps) {
  const { t } = useTranslation(['appAnnotation', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const [page, setPage] = useState(1)
  const history = useQuery(
    consoleQuery.apps.byAppId.annotations.byAnnotationId.hitHistories.get.queryOptions({
      input: {
        params: { app_id: appId, annotation_id: annotationId },
        query: { page, limit: APP_PAGE_LIMIT },
      },
      context: { silent: true },
    }),
  )
  const { data } = history
  if (!data) {
    if (history.isError)
      return (
        <div role="alert" className="space-y-2">
          <p>{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          <Button loading={history.isFetching} onClick={() => history.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )
    return <LoadingPlaceholder />
  }
  if (data.total === 0) return <HitHistoryNoData />
  return (
    <div>
      <p className="mb-3 system-xs-medium text-text-tertiary">
        {data.total}{' '}
        {t(($) => $[`viewModal.hit${data.total > 1 ? 's' : ''}`], { ns: 'appAnnotation' })}
      </p>
      <table className={cn('w-full min-w-110 border-collapse border-0')}>
        <thead className="system-xs-medium-uppercase text-text-tertiary">
          <tr>
            <th className="w-5 rounded-s-lg bg-background-section-burn ps-2 pe-1 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.query'], { ns: 'appAnnotation' })}
            </th>
            <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.match'], { ns: 'appAnnotation' })}
            </th>
            <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.response'], { ns: 'appAnnotation' })}
            </th>
            <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.source'], { ns: 'appAnnotation' })}
            </th>
            <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.score'], { ns: 'appAnnotation' })}
            </th>
            <th className="w-40 rounded-e-lg bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
              {t(($) => $['hitHistoryTable.time'], { ns: 'appAnnotation' })}
            </th>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {data.data.map((item) => (
            <tr
              key={item.id}
              className="cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
            >
              <td
                className="max-w-62.5 overflow-hidden p-3 pe-2 text-ellipsis whitespace-nowrap"
                title={item.question ?? undefined}
              >
                {item.question}
              </td>
              <td
                className="max-w-62.5 overflow-hidden p-3 pe-2 text-ellipsis whitespace-nowrap"
                title={item.match ?? undefined}
              >
                {item.match}
              </td>
              <td
                className="max-w-62.5 overflow-hidden p-3 pe-2 text-ellipsis whitespace-nowrap"
                title={item.response ?? undefined}
              >
                {item.response}
              </td>
              <td className="p-3 pe-2">{item.source}</td>
              <td className="p-3 pe-2">{item.score != null ? item.score.toFixed(2) : '-'}</td>
              <td className="p-3 pe-2">
                {item.created_at
                  ? formatTime(
                      item.created_at,
                      t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                    )
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > APP_PAGE_LIMIT && (
        <Pagination
          page={page}
          totalPages={Math.ceil(data.total / APP_PAGE_LIMIT)}
          onPageChange={setPage}
          labels={{
            previous: t(($) => $['pagination.previous'], { ns: 'common' }),
            next: t(($) => $['pagination.next'], { ns: 'common' }),
            editPageNumber: (page, totalPages) =>
              t(($) => $['pagination.editPageNumber'], { ns: 'common', page, totalPages }),
            pageNumberInput: t(($) => $['pagination.pageNumber'], { ns: 'common' }),
          }}
        />
      )}
    </div>
  )
}
