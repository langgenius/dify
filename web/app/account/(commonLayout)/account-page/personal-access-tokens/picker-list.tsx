import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { noop } from 'es-toolkit/function'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import PickerPagination from './picker-pagination'

type PickerListQuery = ComponentProps<typeof PickerPagination>['query'] &
  Pick<UseInfiniteQueryResult, 'isPending' | 'isError' | 'refetch'>

const feedbackClassName = 'flex min-h-40 flex-col items-center justify-center gap-1 text-center'
const messageClassName = 'system-xs-regular text-text-tertiary'

export default function PickerList({
  children,
  query,
  keyword,
  hasVisibleItems,
  labels,
}: {
  children: ReactNode
  query: PickerListQuery
  keyword: string
  hasVisibleItems: boolean
  labels: {
    loading: string
    loadError: string
    empty: string
    emptyHint?: string
    loadMore: string
  }
}) {
  const { t } = useTranslation(['accountSettings', 'common'])
  const listRef = useRef<HTMLDivElement>(null)
  const loadFailed = query.isError && !query.isFetchNextPageError

  return (
    <div
      ref={listRef}
      tabIndex={-1}
      className="col-span-full mt-2 h-64 overflow-y-auto rounded-lg border border-components-panel-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-state-accent-solid"
    >
      {children}
      {query.isPending && (
        <div className={feedbackClassName} aria-busy="true">
          <p className={messageClassName}>{labels.loading}</p>
          <p className={messageClassName}>
            {t(($) => $['resourceAccessToken.selectionPreservedLoading'])}
          </p>
          <div className="mt-1 flex w-full max-w-68 flex-col gap-1.5" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-background-section" />
            <div className="h-1.5 rounded-full bg-background-section" />
            <div className="h-1.5 rounded-full bg-background-section" />
          </div>
        </div>
      )}
      {loadFailed && (
        <div role="alert" className={feedbackClassName}>
          <p className={messageClassName}>{labels.loadError}</p>
          <p className={messageClassName}>
            {t(($) => $['resourceAccessToken.selectionPreservedError'])}
          </p>
          <Button
            variant="ghost-accent"
            size="small"
            loading={query.isFetching}
            onClick={() => {
              void query.refetch({ cancelRefetch: false }).catch(noop)
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {query.isSuccess && !query.hasNextPage && !hasVisibleItems && (
        <div className={feedbackClassName}>
          <p className={messageClassName}>{labels.empty}</p>
          {labels.emptyHint && <p className={messageClassName}>{labels.emptyHint}</p>}
        </div>
      )}
      {!loadFailed && (
        <PickerPagination
          key={keyword}
          query={query}
          listRef={listRef}
          hasVisibleItems={hasVisibleItems}
          loadMoreLabel={labels.loadMore}
        />
      )}
    </div>
  )
}
