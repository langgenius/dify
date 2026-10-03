'use client'

import type { ResourceAccessTokenRowResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { DialogState } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import DeleteTokenDialog from './delete-token-dialog'
import ResourceAccessTokenDialog from './token-dialog'
import ResourceAccessTokenTable from './token-table'

const PAGE_SIZE = 20

export default function ResourceAccessTokenPage() {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounce(searchText.trim(), { wait: 300 })
  const [dialogState, setDialogState] = useState<DialogState | null>(null)
  const [deletingRow, setDeletingRow] = useState<ResourceAccessTokenRowResponse | null>(null)
  const tokensQuery = useQuery(
    consoleQuery.resourceAccessTokens.get.queryOptions({
      placeholderData: keepPreviousData,
      input: {
        query: {
          keyword: debouncedSearchText || undefined,
          limit: PAGE_SIZE,
          page,
        },
      },
    }),
  )
  const rows = tokensQuery.data?.data
  const total = tokensQuery.data?.total ?? 0
  const hasLoadError = tokensQuery.isError && !tokensQuery.data
  const isEmptyList =
    !tokensQuery.isPending &&
    !tokensQuery.isPlaceholderData &&
    !hasLoadError &&
    total === 0 &&
    !debouncedSearchText

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-80"
          placeholder={t(($) => $['resourceAccessToken.searchPlaceholder'], {
            ns: 'accountSettings',
          })}
          value={searchText}
          onValueChange={(value) => {
            setSearchText(value)
            setPage(1)
          }}
        />
        <Button variant="primary" onClick={() => setDialogState({ mode: 'create' })}>
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['resourceAccessToken.createButton'], { ns: 'accountSettings' })}
        </Button>
      </div>

      {hasLoadError ? (
        <div
          role="alert"
          className="flex min-h-90 flex-col items-center justify-center gap-3 text-center"
        >
          <div className="system-sm-regular text-text-tertiary">
            {t(($) => $['resourceAccessToken.loadError'], { ns: 'accountSettings' })}
          </div>
          <Button onClick={() => void tokensQuery.refetch()}>
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
      ) : (
        <ResourceAccessTokenTable
          rows={rows}
          isPending={tokensQuery.isPending}
          onEdit={(row) => setDialogState({ mode: 'edit', row })}
          onDelete={setDeletingRow}
        />
      )}

      {!hasLoadError && !isEmptyList && (
        <div className="flex items-center gap-4 system-xs-regular text-text-tertiary">
          <span className="shrink-0">
            {t(($) => $['resourceAccessToken.total'], { ns: 'accountSettings', total })}
          </span>
          <Pagination
            className="min-w-0 flex-1 px-0 py-0"
            page={page}
            totalPages={Math.ceil(total / PAGE_SIZE)}
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

      <DeleteTokenDialog row={deletingRow} onOpenChange={(open) => !open && setDeletingRow(null)} />
    </div>
  )
}
