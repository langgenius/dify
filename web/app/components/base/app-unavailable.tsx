'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type IAppUnavailableProps = {
  code?: number | string
  isUnknownReason?: boolean
  unknownReason?: string
  className?: string
}

const AppUnavailable: FC<IAppUnavailableProps> = ({
  code = 404,
  isUnknownReason,
  unknownReason,
  className,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex h-screen w-screen items-center justify-center', className)}>
      <h1
        className="mr-5 h-[50px] shrink-0 pr-5 text-[24px] font-medium leading-[50px]"
        style={{
          borderRight: '1px solid rgba(0,0,0,.3)',
        }}
      >
        {code}
      </h1>
      <div className="text-sm">{unknownReason || (isUnknownReason ? t('common.appUnknownError', { ns: 'share' }) : t('common.appUnavailable', { ns: 'share' }))}</div>
    </div>
  )
}
export default React.memo(AppUnavailable)
