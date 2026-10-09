import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useMemo } from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { OnlineDriveFileType } from '@/models/pipeline'
import { getFileType } from './utils'

type FileIconProps = {
  type: OnlineDriveFileType
  fileName: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const FileIcon = ({ type, fileName, size = 'md', className }: FileIconProps) => {
  const fileType = useMemo(() => {
    if (type === OnlineDriveFileType.bucket || type === OnlineDriveFileType.folder) return 'custom'

    return getFileType(fileName)
  }, [type, fileName])

  if (type === OnlineDriveFileType.bucket) {
    return (
      <span
        aria-hidden
        className={cn(
          'i-custom-public-knowledge-online-drive-buckets-blue h-5.25 w-5',
          cn('size-4.5', className),
        )}
      />
    )
  }

  if (type === OnlineDriveFileType.folder) {
    return (
      <span
        aria-hidden
        className={cn(
          'i-custom-public-knowledge-online-drive-folder h-4.75 w-5',
          cn('size-4.5', className),
        )}
      />
    )
  }

  return <FileTypeIcon size={size} type={fileType} className={cn('size-4.5', className)} />
}

export default React.memo(FileIcon)
