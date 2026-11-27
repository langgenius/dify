'use client'
import type { FC } from 'react'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

export type QueryParam = {
  keyword?: string
}

type IFilterProps = {
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  children: React.JSX.Element
}

const Filter: FC<IFilterProps> = ({ appId, queryParams, setQueryParams, children }) => {
  const countQuery = useQuery(
    consoleQuery.apps.byAppId.annotations.count.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const { data, isLoading } = countQuery
  const { t } = useTranslation(['common'])
  const countLoad = useOwnedQueryError(countQuery)
  const errorMessage = useRequestErrorMessage(
    countLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )
  if (countLoad && errorMessage)
    return (
      <Alert type="error" className="mb-2">
        <AlertTitle>{errorMessage}</AlertTitle>
        <AlertActions>
          <Button size="small" loading={countLoad.retrying} onClick={countLoad.retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </AlertActions>
      </Alert>
    )
  if (isLoading || !data) return null
  return (
    <div className="mb-2 flex flex-row flex-wrap items-center justify-between gap-2">
      <SearchInput
        className="w-50"
        value={queryParams.keyword ?? ''}
        placeholder={t(($) => $['operation.search'], { ns: 'common' })!}
        onValueChange={(value) => {
          setQueryParams({ ...queryParams, keyword: value })
        }}
      />
      {children}
    </div>
  )
}
export default React.memo(Filter)
