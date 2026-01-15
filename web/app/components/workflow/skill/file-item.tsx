import type { FC, ReactNode } from 'react'
import * as React from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { cn } from '@/utils/classnames'
import { getFileIconType } from './utils'

type FileItemProps = {
  name: string
  prefix?: ReactNode
  active?: boolean
}

const FileItem: FC<FileItemProps> = ({ name, prefix, active = false }) => {
  const appearanceType = getFileIconType(name)

  return (
    <div
      className={cn(
        'flex h-6 items-center rounded-md pl-2 pr-1.5 text-text-secondary',
        active && 'bg-state-base-active text-text-primary',
      )}
    >
      {prefix}
      <div className="flex items-center gap-2 py-0.5">
        <FileTypeIcon type={appearanceType} size="sm" className={cn(active && 'text-text-primary')} />
        <span className={cn('system-sm-regular', active && 'font-medium text-text-primary')}>
          {name}
        </span>
      </div>
    </div>
  )
}

export default React.memo(FileItem)
