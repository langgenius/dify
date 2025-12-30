'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
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

const Filter: FC<IFilterProps> = ({
  appId,
  queryParams,
  setQueryParams,
  children,
}) => {
  const { data, isLoading } = useAnnotationsCount(appId)
  const { t } = useTranslation()
  if (isLoading || !data)
    return null
  return (
    <div className="mb-2 flex flex-row flex-wrap items-center justify-between gap-2">
      <Input
        wrapperClassName="w-[200px]"
        showLeftIcon
        showClearIcon
        value={queryParams.keyword}
        placeholder={t('operation.search', { ns: 'common' })!}
        onChange={(e) => {
          setQueryParams({ ...queryParams, keyword: e.target.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, keyword: '' })}
      />
      {children}
    </div>
  )
}
export default React.memo(Filter)
