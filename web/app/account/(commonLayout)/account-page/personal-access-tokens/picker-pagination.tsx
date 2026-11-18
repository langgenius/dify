import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { noop } from 'es-toolkit/function'
import { useId, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

type PickerPageQuery = Pick<
  UseInfiniteQueryResult<InfiniteData<unknown>>,
  | 'data'
  | 'fetchNextPage'
  | 'hasNextPage'
  | 'isFetching'
  | 'isFetchingNextPage'
  | 'isFetchNextPageError'
  | 'isSuccess'
>

const optionSelector = '[data-pat-picker-item]:not(:disabled):not([data-disabled])'

export default function PickerPagination({
  query,
  listRef,
  hasVisibleItems,
  loadMoreLabel,
}: {
  query: PickerPageQuery
  listRef: RefObject<HTMLDivElement | null>
  hasVisibleItems: boolean
  loadMoreLabel: string
}) {
  const { t } = useTranslation(['accountSettings', 'common'])
  const labelId = useId()
  const endRef = useRef<HTMLParagraphElement>(null)
  const focusRequestRef = useRef<{
    button: HTMLButtonElement
    items: Set<HTMLElement>
    pageCount: number
  } | null>(null)
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError } = query
  const pageCount = query.data?.pages.length ?? 0
  const showEnd = query.isSuccess && pageCount > 1 && hasVisibleItems && !hasNextPage

  useLayoutEffect(() => {
    const request = focusRequestRef.current
    if (!request || isFetchingNextPage) return
    focusRequestRef.current = null
    if (isFetchNextPageError || pageCount <= request.pageCount) return

    const list = listRef.current
    if (!list) return
    const { activeElement, body } = list.ownerDocument
    const focusFellBack =
      !request.button.isConnected &&
      (activeElement === body || activeElement === list.closest('[role="dialog"]'))
    if (activeElement !== request.button && !focusFellBack) return

    const firstNewItem = Array.from(list.querySelectorAll<HTMLElement>(optionSelector)).find(
      (item) => !request.items.has(item),
    )
    if (firstNewItem) firstNewItem.focus()
    else if (!hasNextPage) (endRef.current ?? list).focus({ preventScroll: true })
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, listRef, pageCount])

  if (!hasNextPage && !showEnd) return null

  const label = isFetchingNextPage
    ? t(($) => $.loading, { ns: 'common' })
    : isFetchNextPageError
      ? t(($) => $['personalAccessToken.loadMoreRetry'])
      : loadMoreLabel

  return (
    <div className="-mx-4 mt-2 -mb-2 border-t border-divider-subtle p-1 [overflow-anchor:none]">
      {hasNextPage ? (
        <Button
          variant="ghost"
          className="h-auto min-h-8 w-full py-1.5 text-center whitespace-normal"
          aria-labelledby={labelId}
          loading={isFetchingNextPage}
          disabled={query.isFetching && !isFetchingNextPage}
          onClick={(event) => {
            const list = listRef.current
            focusRequestRef.current = null
            if (
              event.detail === 0 &&
              list &&
              event.currentTarget === list.ownerDocument.activeElement
            ) {
              focusRequestRef.current = {
                button: event.currentTarget,
                items: new Set(list.querySelectorAll<HTMLElement>(optionSelector)),
                pageCount,
              }
            }
            void query.fetchNextPage({ cancelRefetch: false }).catch(noop)
          }}
        >
          <span id={labelId} aria-live="polite">
            {label}
          </span>
        </Button>
      ) : (
        <p
          ref={endRef}
          tabIndex={-1}
          role="status"
          className="flex min-h-8 items-center justify-center rounded-lg px-3.5 py-1.5 text-center system-xs-regular text-text-tertiary focus-visible:outline-2 focus-visible:outline-state-accent-solid"
        >
          {t(($) => $['personalAccessToken.allResultsShown'])}
        </p>
      )}
    </div>
  )
}
