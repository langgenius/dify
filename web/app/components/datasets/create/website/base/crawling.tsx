'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { RowStruct } from '@/app/components/base/icons/src/public/other'

type Props = {
  className?: string
  crawledNum: number
  totalNum: number
}

const Crawling: FC<Props> = ({
  className = '',
  crawledNum,
  totalNum,
}) => {
  const { t } = useTranslation()

  return (
    <div className={className}>
      <div className="flex h-[34px] items-center border-y-[0.5px] border-divider-regular px-4
        text-xs text-text-tertiary shadow-xs shadow-shadow-shadow-3"
      >
        {t('stepOne.website.totalPageScraped', { ns: 'datasetCreation' })}
        {' '}
        {crawledNum}
        /
        {totalNum}
      </div>

      <div className="p-2">
        {['', '', '', ''].map((item, index) => (
          <div className="py-[5px]" key={index}>
            <RowStruct className="text-text-quaternary" />
          </div>
        ))}
      </div>
    </div>
  )
}
export default React.memo(Crawling)
