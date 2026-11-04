import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type FileIconProps = {
  type: string
  className?: string
}

const FileIcon: FC<FileIconProps> = ({ type, className }) => {
  switch (type) {
    case 'csv':
      return <span aria-hidden className={cn('i-custom-public-files-csv h-8.5 w-8', className)} />
    case 'doc':
      return <span aria-hidden className={cn('i-custom-public-files-doc h-8.5 w-8', className)} />
    case 'docx':
      return <span aria-hidden className={cn('i-custom-public-files-docx h-8.5 w-8', className)} />
    case 'htm':
    case 'html':
      return <span aria-hidden className={cn('i-custom-public-files-html h-8.5 w-8', className)} />
    case 'json':
      return <span aria-hidden className={cn('i-custom-public-files-json h-8.5 w-8', className)} />
    case 'md':
    case 'markdown':
    case 'mdx':
      return <span aria-hidden className={cn('i-custom-public-files-md h-8.5 w-8', className)} />
    case 'pdf':
      return <span aria-hidden className={cn('i-custom-public-files-pdf h-8.5 w-8', className)} />
    case 'txt':
      return <span aria-hidden className={cn('i-custom-public-files-txt h-8.5 w-8', className)} />
    case 'xls':
    case 'xlsx':
      return <span aria-hidden className={cn('i-custom-public-files-xlsx h-6.5 w-6', className)} />
    case 'notion':
      return <span aria-hidden className={cn('i-custom-public-common-notion h-5 w-5', className)} />
    default:
      return (
        <span aria-hidden className={cn('i-custom-public-files-unknown h-8.5 w-8', className)} />
      )
  }
}

export default FileIcon
