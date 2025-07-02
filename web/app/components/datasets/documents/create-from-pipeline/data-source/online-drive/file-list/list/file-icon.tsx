import React from 'react'
import { OnlineDriveFileType } from '@/models/pipeline'
import { BucketsBlue, Folder } from '@/app/components/base/icons/src/public/knowledge/online-drive'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { getFileType } from './utils'
import cn from '@/utils/classnames'

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
      type={getFileType(fileName)}
      className={cn('size-[18px]', className)}
    />
  )
}

export default React.memo(FileIcon)
