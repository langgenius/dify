import type { FC } from 'react'
import {
  Csv,
  Doc,
  Docx,
  Html,
  Json,
  Md,
  Pdf,
  Txt,
  Unknown,
  Xlsx,
} from '@/app/components/base/icons/src/public/files'
import { Notion } from '@/app/components/base/icons/src/public/common'

type FileIconProps = {
  type: string
  className?: string
}

const FileIcon: FC<FileIconProps> = ({
  type,
  className,
}) => {
  switch (type) {
    case 'csv':
      return <Csv className={className} />
    case 'doc':
      return <Doc className={className} />
    case 'docx':
      return <Docx className={className} />
    case 'htm':
    case 'html':
      return <Html className={className} />
    case 'json':
      return <Json className={className} />
    case 'md':
    case 'markdown':
    case 'mdx':
      return <Md className={className} />
    case 'pdf':
      return <Pdf className={className} />
    case 'txt':
      return <Txt className={className} />
    case 'xls':
    case 'xlsx':
      return <Xlsx className={className} />
    case 'notion':
      return <Notion className={className} />
    default:
      return <Unknown className={className} />
  }
}

export default FileIcon
