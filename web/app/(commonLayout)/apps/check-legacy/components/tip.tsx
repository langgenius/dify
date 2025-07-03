'use client'
import { RiBookOpenLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'app.checkLegacy.tip'

const Tip: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='w-[316px] rounded-xl bg-background-section p-6'>
      <div className='inline-flex rounded-[10px] border-[0.5px]  border-components-card-border bg-components-card-border p-2 shadow-lg backdrop-blur-[5px]'>
        <RiBookOpenLine className='size-5 text-text-accent' />
      </div>
      <div className='system-xl-semibold mt-3 text-text-primary'>{t(`${i18nPrefix}.title`)}</div>
      <div className='system-sm-regular mt-2 text-text-secondary'>{t(`${i18nPrefix}.description`)}</div>
      <a className='system-sm-medium mt-2 text-text-accent' target='_blank' href='todo'>{t(`${i18nPrefix}.learnMore`)}</a>
    </div>
  )
}

export default React.memo(Tip)
