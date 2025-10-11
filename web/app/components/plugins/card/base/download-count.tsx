import { RiInstallLine } from '@remixicon/react'
import { formatNumber } from '@/utils/format'

type Props = {
  downloadCount: number
}

const DownloadCount = ({
  downloadCount,
}: Props) => {
  return (
    <div className="flex items-center space-x-1 text-text-tertiary">
      <RiInstallLine className="h-3 w-3 shrink-0" />
      <div className="system-xs-regular">{formatNumber(downloadCount)}</div>
    </div>
  )
}

export default DownloadCount
