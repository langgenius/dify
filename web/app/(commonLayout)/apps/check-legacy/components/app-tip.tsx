'use client'
import { RiArrowRightLine, RiImage2Fill } from '@remixicon/react'
import Link from 'next/link'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'app.checkLegacy'

type Props = {
  appNum: number,
  publishedNum: number,
}

const AppTip: FC<Props> = ({
  appNum,
  publishedNum,
}) => {
  const { t } = useTranslation()
  return (
    <div className='fixed bottom-0 left-0 right-0 z-10 border-t border-state-warning-hover px-[60px] py-4'>
      <div className="absolute inset-0 bg-[linear-gradient(92deg,_rgba(247,144,9,0.25)_53.67%,_rgba(255,255,255,0)_100%)] opacity-40" />
      <div className='relative flex items-center'>
        <div className='relative rounded-lg bg-text-accent p-1.5'>
          <RiImage2Fill className='size-5 text-text-primary-on-surface' />
          <div className='border-px absolute left-[-2px] top-[-2px] size-2 rounded-[3px] border-white bg-components-badge-status-light-error-border-inner p-0.5'>
            <div className='h-full w-full rounded-[3px] bg-components-badge-status-light-error-bg'></div>
          </div>
        </div>

        <div className='ml-3'>
          <div className='system-md-semibold text-text-primary'>{t(`${i18nPrefix}.title`)}</div>
          <div className='system-sm-regular mt-1 flex items-center space-x-0.5 text-text-secondary'>
            {t(`${i18nPrefix}.description`, { num: appNum, publishedNum })}
            <Link className='system-sm-semibold text-text-accent' href='/apps/check-legacy'>{t(`${i18nPrefix}.toSolve`)}</Link>
            <RiArrowRightLine className='size-4 text-components-button-secondary-accent-text' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(AppTip)
