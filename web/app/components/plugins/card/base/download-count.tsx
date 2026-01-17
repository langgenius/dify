import { RiInstallLine } from '@remixicon/react'
import * as React from 'react'
import { formatNumber } from '@/utils/format'

type Props = {
  downloadCount: number
}

const DownloadCountComponent = ({
  downloadCount,
}: Props) => {
  return (
    <div className="flex items-center space-x-1 text-text-tertiary">
      <RiInstallLine className="h-3 w-3 shrink-0" />
      <div className="system-xs-regular">{formatNumber(downloadCount)}</div>
    </div>
  )
}

// Memoize to prevent unnecessary re-renders
const DownloadCount = React.memo(DownloadCountComponent)

export default DownloadCount
