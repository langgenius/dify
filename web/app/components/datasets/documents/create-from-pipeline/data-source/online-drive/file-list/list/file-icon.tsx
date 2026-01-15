import * as React from 'react'
import { useMemo } from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { BucketsBlue, Folder } from '@/app/components/base/icons/src/public/knowledge/online-drive'
import { OnlineDriveFileType } from '@/models/pipeline'
import { cn } from '@/utils/classnames'
import { getFileType } from './utils'

type FileIconProps = {
  type: OnlineDriveFileType
  fileName: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const FileIcon = ({
  type,
  fileName,
  size = 'md',
  className,
}: FileIconProps) => {
  const fileType = useMemo(() => {
    if (type === OnlineDriveFileType.bucket || type === OnlineDriveFileType.folder)
      return 'custom'

    return getFileType(fileName)
  }, [type, fileName])

  if (type === OnlineDriveFileType.bucket) {
    return (
      <BucketsBlue className={cn('size-[18px]', className)} />
    )
  }

  if (type === OnlineDriveFileType.folder) {
    return (
      <Folder className={cn('size-[18px]', className)} />
    )
  }

  return (
    <FileTypeIcon
      size={size}
      type={fileType}
      className={cn('size-[18px]', className)}
    />
  )
}

export default React.memo(FileIcon)
