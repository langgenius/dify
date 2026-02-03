import { useTranslation } from '#i18n'
import * as React from 'react'
import { formatNumber } from '@/utils/format'

type Props = {
  downloadCount: number
}

const DownloadCountComponent = ({
  downloadCount,
}: Props) => {
  const { t } = useTranslation('plugin')

  return (
    <div className="system-xs-regular text-text-tertiary">
      {formatNumber(downloadCount)}
      {' '}
      {t('marketplace.installs')}
    </div>
  )
}

// Memoize to prevent unnecessary re-renders
const DownloadCount = React.memo(DownloadCountComponent)

export default DownloadCount
