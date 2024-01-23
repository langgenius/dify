'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  value: string
  onChange: (v: string) => void
}

const Search: FC<Props> = ({
  className,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(className, 'flex relative')}>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
      </div>
      <input
        type="text"
        name="query"
        className="block w-0 grow bg-gray-200 shadow-sm rounded-md border-0 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none sm:text-sm sm:leading-8"
        placeholder={t('common.operation.search')!}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </div>
  )
}
export default React.memo(Search)
