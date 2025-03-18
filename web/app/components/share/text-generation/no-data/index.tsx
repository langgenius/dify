import type { FC } from 'react'
import React from 'react'
import {
  RiSparklingFill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'

export type INoDataProps = {}
const NoData: FC<INoDataProps> = () => {
  const { t } = useTranslation()
  return (
    <div className='flex flex-col h-full w-full justify-center items-center'>
      <RiSparklingFill className='w-12 h-12 text-text-empty-state-icon' />
      <div
        className='mt-2 text-text-quaternary system-sm-regular'
      >
        {t('share.generation.noData')}
      </div>
    </div>
  )
}
export default React.memo(NoData)
