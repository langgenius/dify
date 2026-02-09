'use client'
import { RiAlertFill, RiTimeLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { getRelativeTime, isRelativeTimeSameOrAfter } from './utils'

type ExpirationTimeProps = {
  expirationTime: number
}

const ExpirationTime = ({
  expirationTime,
}: ExpirationTimeProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const relativeTime = getRelativeTime(expirationTime, locale)
  const isSameOrAfter = isRelativeTimeSameOrAfter(expirationTime)

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-x-1 text-text-tertiary system-xs-regular',
        !isSameOrAfter && 'text-text-warning',
      )}
    >
      {
        isSameOrAfter
          ? (
              <>
                <RiTimeLine className="size-3.5" />
                <span>{t('humanInput.expirationTimeNowOrFuture', { relativeTime, ns: 'share' })}</span>
              </>
            )
          : (
              <>
                <RiAlertFill className="size-3.5" />
                <span>{t('humanInput.expiredTip', { ns: 'share' })}</span>
              </>
            )
      }
    </div>
  )
}

export default ExpirationTime
