'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  children: React.ReactNode
}

const OptionsWrap: FC<Props> = ({
  children,
}) => {
  const { t } = useTranslation()

  const [fold, {
    setTrue: foldTrue,
    setFalse: foldFalse,
    toggle: foldToggle,
  }] = useBoolean(false)
  return (
    <div>
      <div className='flex justify-between items-center h-[18px] py-1'>
        <div className='flex items-center text-gray-700'>
          <Settings04 className='mr-1 w-4 h-4' />
          <div>{t(`${I18N_PREFIX}.options`)}</div>
        </div>

      </div>
      {!fold && (
        <div>
          {children}
        </div>
      )}

    </div>
  )
}
export default React.memo(OptionsWrap)
