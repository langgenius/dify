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
    <div className='flex h-full w-full flex-col items-center justify-center'>
      <RiSparklingFill className='h-12 w-12 text-text-empty-state-icon' />
      <div
        className='system-sm-regular mt-2 text-text-quaternary'
      >
        {t('share.generation.noData')}
      </div>
    </div>
  )
}
export default React.memo(NoData)
