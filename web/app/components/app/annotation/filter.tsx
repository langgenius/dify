'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import Input from '@/app/components/base/input'
import { fetchAnnotationsCount } from '@/service/log'

export type QueryParam = {
  keyword?: string
}

type IFilterProps = {
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  children: JSX.Element
}

const Filter: FC<IFilterProps> = ({
  appId,
  queryParams,
  setQueryParams,
  children,
}) => {
  // TODO: change fetch list api
  const { data } = useSWR({ url: `/apps/${appId}/annotations/count` }, fetchAnnotationsCount)
  const { t } = useTranslation()
  if (!data)
    return null
  return (
    <div className='flex justify-between flex-row flex-wrap gap-2 items-center mb-2'>
      <Input
        wrapperClassName='w-[200px]'
        showLeftIcon
        showClearIcon
        value={queryParams.keyword}
        placeholder={t('common.operation.search')!}
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
