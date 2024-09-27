'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import type { QueryParam } from './index'
import { SimpleSelect } from '@/app/components/base/select'

type IFilterProps = {
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
}

const Filter: FC<IFilterProps> = ({ queryParams, setQueryParams }: IFilterProps) => {
  const { t } = useTranslation()
  return (
    <div className='flex flex-row flex-wrap gap-y-2 gap-x-4 items-center mb-4 text-gray-900 text-base'>
      <div className="relative rounded-md">
        <SimpleSelect
          defaultValue={'all'}
          className='!min-w-[100px]'
          onSelect={
            (item) => {
              if (!item.value)
                return
              setQueryParams({ ...queryParams, status: item.value as string })
            }
          }
          items={[{ value: 'all', name: 'All' },
            { value: 'succeeded', name: 'Success' },
            { value: 'failed', name: 'Fail' },
            { value: 'stopped', name: 'Stop' },
          ]}
        />
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
        </div>
        <input
          type="text"
          name="query"
          className="block w-[240px] bg-gray-100 shadow-sm rounded-md border-0 py-1.5 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none sm:text-sm sm:leading-6"
          placeholder={t('common.operation.search')!}
          value={queryParams.keyword}
          onChange={(e) => {
            setQueryParams({ ...queryParams, keyword: e.target.value })
          }}
        />
      </div>
    </div>
  )
}

export default Filter
