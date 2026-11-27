'use client'

import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { DeleteTokenParams, DialogState } from './types'
import { AlertDialog } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { getErrorMessage } from '@/utils/error-message'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { DeleteTokenDialogContent } from './delete-token-dialog'
import ResourceAccessTokenDialog from './token-dialog'
import ResourceAccessTokenTable from './token-table'

const PAGE_SIZE = 20
const deleteToken = consoleQuery.resourceAccessTokens.byTokenId.relations.byRelationId.delete

export default function ResourceAccessTokenPage() {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounce(searchText.trim(), { wait: 300 })
  const [dialogState, setDialogState] = useState<DialogState | null>(null)
  const queryClient = useQueryClient()
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const deleteDialogActionsRef = useRef<AlertDialogActions>(null)
  const deleteFocusRef = useRef<{
    opener: Element | undefined
    adjacentTargets: HTMLElement[]
    succeeded: boolean
  }>(null)
  const deleteInFlightRef = useRef(false)
  const tokenOptions = consoleQuery.resourceAccessTokens.get.queryOptions({
    placeholderData: keepPreviousData,
    input: {
      query: {
        keyword: debouncedSearchText || undefined,
        limit: PAGE_SIZE,
        page,
      },
    },
  })
  const tokensQuery = useQuery(tokenOptions)
  const isSwitchingTokenList =
    searchText.trim() !== debouncedSearchText || tokensQuery.isPlaceholderData
  const deleteErrorMessage = (error: unknown) =>
    getErrorMessage(error) ?? t(($) => $['api.actionFailed'], { ns: 'common' })
  const deletion = useMutation(
    deleteToken.mutationOptions({
      meta: { errorToast: false },
      onError: (error) => {
        if (!deleteDialogActionsRef.current) toast.error(deleteErrorMessage(error))
      },
    }),
  )
  const canDelete = (params: DeleteTokenParams) =>
    !isSwitchingTokenList &&
    (queryClient
      .getQueryData(tokenOptions.queryKey)
      ?.data.some(
        (row) => row.token_id === params.token_id && row.relation_id === params.relation_id,
      ) ??
      false)
  const confirmDelete = async (params: DeleteTokenParams) => {
    if (!deleteDialogActionsRef.current || !canDelete(params) || deleteInFlightRef.current) return
    deleteInFlightRef.current = true
    try {
      await deletion.mutateAsync({ params })
      if (!deleteDialogActionsRef.current) return
      if (deleteFocusRef.current) deleteFocusRef.current.succeeded = true
      deleteDialogActionsRef.current.close()
    } catch {
      // The mutation reports failure in the dialog or through its fallback toast.
    } finally {
      deleteInFlightRef.current = false
    }
  }
  const rows = tokensQuery.data?.data
  const total = tokensQuery.data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const lastPage = Math.max(1, totalPages)
  if (tokensQuery.isSuccess && !tokensQuery.isPlaceholderData && page > lastPage) setPage(lastPage)
  // A failed page load replaces the list; a failed refetch keeps it and the cache reports it.
  const tokensLoad = useOwnedQueryError(tokensQuery)
  const isEmptyList =
    !tokensQuery.isPending &&
    !tokensQuery.isPlaceholderData &&
    !tokensLoad &&
    total === 0 &&
    !debouncedSearchText

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          className="w-80 max-w-full"
          placeholder={t(($) => $['resourceAccessToken.searchPlaceholder'], {
            ns: 'accountSettings',
          })}
          value={searchText}
          onValueChange={(value) => {
            setSearchText(value)
            setPage(1)
          }}
        />
        <Button
          ref={createButtonRef}
          variant="primary"
          onClick={() => setDialogState({ mode: 'create' })}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['resourceAccessToken.createButton'], { ns: 'accountSettings' })}
        </Button>
      </div>

      {tokensLoad ? (
        <div
          role="alert"
          className="flex min-h-90 flex-col items-center justify-center gap-3 text-center"
        >
          <div className="system-sm-regular text-text-tertiary">
            {t(($) => $['resourceAccessToken.loadError'], { ns: 'accountSettings' })}
          </div>
          <Button loading={tokensLoad.retrying} onClick={tokensLoad.retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      ) : isEmptyList ? (
        <div className="flex min-h-90 items-center justify-center text-center">
          <div className="grid max-w-130 gap-3">
            <div className="title-md-semi-bold text-text-primary">
              {t(($) => $['resourceAccessToken.empty'], { ns: 'accountSettings' })}
            </div>
            <div className="system-md-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.emptyDescription'], { ns: 'accountSettings' })}
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog<DeleteTokenParams>
        actionsRef={deleteDialogActionsRef}
        onOpenChange={(open, details) => {
          if (open) {
            deletion.reset()
            const opener = details.trigger
            deleteFocusRef.current = {
              opener,
              adjacentTargets: getAdjacentFocusTargets(opener?.closest('tr'), (row) =>
                row.querySelector<HTMLElement>('[data-token-edit]'),
              ),
              succeeded: false,
            }
          } else if (details.reason !== 'imperative-action' && deleteInFlightRef.current) {
            details.cancel()
          }
        }}
      >
        {({ payload }) => (
          <>
            {!tokensLoad && !isEmptyList && (
              <ResourceAccessTokenTable
                rows={rows}
                deletionDisabled={isSwitchingTokenList}
                isPending={tokensQuery.isPending}
                onEdit={(row) => setDialogState({ mode: 'edit', row })}
              />
            )}
            {payload && (
              <DeleteTokenDialogContent
                isPending={deletion.isPending}
                canDelete={canDelete(payload)}
                error={deletion.isError ? deleteErrorMessage(deletion.error) : undefined}
                finalFocus={() => {
                  const focus = deleteFocusRef.current
                  if (!focus || (!focus.succeeded && focus.opener?.isConnected)) return true
                  return (
                    focus.adjacentTargets.find((element) => element.isConnected) ??
                    createButtonRef.current
                  )
                }}
                onConfirm={() => void confirmDelete(payload)}
              />
            )}
          </>
        )}
      </AlertDialog>

      {!tokensLoad && !isEmptyList && (
        <div className="flex items-center gap-4 system-xs-regular text-text-tertiary">
          <span className="shrink-0">
            {t(($) => $['resourceAccessToken.total'], { ns: 'accountSettings', total })}
          </span>
          <Pagination
            className="min-w-0 flex-1 px-0 py-0"
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            labels={{
              previous: t(($) => $['resourceAccessToken.previous'], { ns: 'accountSettings' }),
              next: t(($) => $['resourceAccessToken.next'], { ns: 'accountSettings' }),
              editPageNumber: (page, totalPages) =>
                t(($) => $['pagination.editPageNumber'], { ns: 'common', page, totalPages }),
              pageNumberInput: t(($) => $['pagination.pageNumber'], { ns: 'common' }),
            }}
          />
        </div>
      )}

      {dialogState && (
        <ResourceAccessTokenDialog
          open
          state={dialogState}
          onOpenChange={(open) => !open && setDialogState(null)}
          onSaved={() => {
            setDialogState(null)
          }}
        />
      )}
    </div>
  )
}
