import type { FC, ReactNode } from 'react'
import * as React from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { cn } from '@/utils/classnames'

type FileItemProps = {
  name: string
  prefix?: ReactNode
  active?: boolean
}

const getAppearanceType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  if (['md', 'markdown', 'mdx'].includes(extension))
    return FileAppearanceTypeEnum.markdown

  if (['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema'].includes(extension))
    return FileAppearanceTypeEnum.code

  return FileAppearanceTypeEnum.document
}

const FileItem: FC<FileItemProps> = ({ name, prefix, active = false }) => {
  const appearanceType = getAppearanceType(name)

  return (
    <div
      className={cn(
        'flex h-6 items-center rounded-md pl-2 pr-1.5 text-text-secondary',
        active && 'bg-state-base-active text-text-primary',
      )}
      data-component="file-item"
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
