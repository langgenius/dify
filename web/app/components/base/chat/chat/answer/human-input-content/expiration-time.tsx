'use client'
import { useTranslation } from 'react-i18next'
import { useI18N } from '@/context/i18n'
import { formatRelativeTimeInZone } from './utils'

type ExpirationTimeProps = {
  expirationTime: number
}

const ExpirationTime = ({
  expirationTime,
}: ExpirationTimeProps) => {
  const { t } = useTranslation()
  const { locale } = useI18N()
  const relativeTime = formatRelativeTimeInZone(expirationTime, locale)

  return (
    <div className="system-xs-regular mt-1 text-text-tertiary">
      {t('humanInput.expirationTime', { relativeTime, ns: 'share' })}
    </div>
  )
}

export default ExpirationTime
