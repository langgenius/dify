'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import useSWR from 'swr'
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
    <div className='flex justify-between flex-row flex-wrap gap-y-2 gap-x-4 items-center mb-4 text-gray-900 text-base'>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
        </div>
        <input
          type="text"
          name="query"
          className="block w-[240px] bg-gray-100 shadow-sm rounded-md border-0 py-1.5 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none sm:text-sm sm:leading-6"
          placeholder={t('common.operation.search') as string}
          value={queryParams.keyword}
          onChange={(e) => {
            setQueryParams({ ...queryParams, keyword: e.target.value })
          }}
        />
      </div>
      {children}
    </div>
  )
}
export default React.memo(Filter)
