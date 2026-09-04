'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { useAnnotationsCount } from '@/service/use-log'

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
  const { data, isLoading } = useAnnotationsCount(appId)
  const { t } = useTranslation()
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
