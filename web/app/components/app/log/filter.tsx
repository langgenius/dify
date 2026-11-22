'use client'
import type { FC, ReactNode } from 'react'
import type { LogFilterOptions, LogIdentity, QueryParam } from './log-filters'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import { Sort } from '@/app/components/base/sort'
import { LogIdentityField } from './log-identity-picker'

type IFilterProps = {
  isChatMode?: boolean
  appId: string
  filterOptions: LogFilterOptions
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  identityOptions?: LogIdentity[]
  actions?: ReactNode
}

const Filter: FC<IFilterProps> = ({
  isChatMode,
  appId,
  filterOptions: { periods, annotations, hasAnnotationCount, clearedPeriod },
  queryParams,
  setQueryParams,
  identityOptions,
  actions,
}: IFilterProps) => {
  const { t } = useTranslation(['appLog', 'common'])

  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2">
      <Chip
        className="min-w-37.5"
        panelClassName="w-[270px]"
        leftIcon={<span className="i-ri-calendar-line size-4 text-text-secondary" aria-hidden />}
        value={queryParams.period}
        onSelect={(item) => {
          setQueryParams({ ...queryParams, period: item.value })
        }}
        onClear={() => setQueryParams({ ...queryParams, period: clearedPeriod })}
        items={periods.map(({ value, label }) => ({ value, name: label }))}
      />
      <Chip
        className="min-w-37.5"
        panelClassName="w-[270px]"
        disabled={!hasAnnotationCount}
        showLeftIcon={false}
        value={queryParams.annotation_status || 'all'}
        onSelect={(item) => {
          setQueryParams({
            ...queryParams,
            annotation_status: item.value,
          })
        }}
        onClear={() => setQueryParams({ ...queryParams, annotation_status: 'all' })}
        items={annotations.map(({ value, label }) => ({ value, name: label }))}
      />
      {identityOptions && (
        <LogIdentityField
          appId={appId}
          options={identityOptions}
          value={queryParams.identities ?? []}
          onChange={(identities) => setQueryParams({ ...queryParams, identities })}
          disabled={false}
          applyOnClose
        />
      )}
      <SearchInput
        className="w-50"
        value={queryParams.keyword ?? ''}
        placeholder={t(($) => $['operation.search'], { ns: 'common' })!}
        onValueChange={(value) => {
          setQueryParams({ ...queryParams, keyword: value })
        }}
      />
      {isChatMode && (
        <>
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <Sort
            value={{
              field: queryParams.sort_by?.endsWith('updated_at') ? 'updated_at' : 'created_at',
              order: queryParams.sort_by?.startsWith('-') ? 'desc' : 'asc',
            }}
            items={[
              { value: 'created_at', name: t(($) => $['table.header.time'], { ns: 'appLog' }) },
              {
                value: 'updated_at',
                name: t(($) => $['table.header.updatedTime'], { ns: 'appLog' }),
              },
            ]}
            onValueChange={({ field, order }) => {
              setQueryParams({ ...queryParams, sort_by: order === 'desc' ? `-${field}` : field })
            }}
          />
        </>
      )}
      {actions ? <div className="ms-auto">{actions}</div> : null}
    </div>
  )
}

export default Filter
