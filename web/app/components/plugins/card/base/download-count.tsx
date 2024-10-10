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
      <RiInstallLine className="shrink-0 w-3 h-3" />
      <div className="system-xs-regular">{formatNumber(downloadCount)}</div>
    </div>
  )
}

export default DownloadCount
