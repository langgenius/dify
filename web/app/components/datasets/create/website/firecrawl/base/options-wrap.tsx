'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  className?: string
  children: React.ReactNode
  controlFoldOptions?: number
}

const OptionsWrap: FC<Props> = ({
  className = '',
  children,
  controlFoldOptions,
}) => {
  const { t } = useTranslation()

  const [fold, {
    toggle: foldToggle,
    setTrue: foldHide,
  }] = useBoolean(false)

  useEffect(() => {
    if (controlFoldOptions)
      foldHide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlFoldOptions])
  return (
    <div className={cn(className, !fold ? 'mb-0' : 'mb-3')}>
      <div
        className='flex justify-between items-center h-[26px] py-1 cursor-pointer select-none'
        onClick={foldToggle}
      >
        <div className='flex items-center text-gray-700'>
          <Settings04 className='mr-1 w-4 h-4' />
          <div className='text-[13px] font-semibold text-gray-800 uppercase'>{t(`${I18N_PREFIX}.options`)}</div>
        </div>
        <ChevronRight className={cn(!fold && 'rotate-90', 'w-4 h-4 text-gray-500')} />
      </div>
      {!fold && (
        <div className='mb-4'>
          {children}
        </div>
      )}

    </div>
  )
}
export default React.memo(OptionsWrap)
