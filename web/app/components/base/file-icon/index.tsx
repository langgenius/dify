import type { FC } from 'react'
import Notion from '@/app/components/base/icons/src/public/common/Notion'
import Csv from '@/app/components/base/icons/src/public/files/Csv'
import Doc from '@/app/components/base/icons/src/public/files/Doc'
import Docx from '@/app/components/base/icons/src/public/files/Docx'
import Html from '@/app/components/base/icons/src/public/files/Html'
import Json from '@/app/components/base/icons/src/public/files/Json'
import Md from '@/app/components/base/icons/src/public/files/Md'
import Pdf from '@/app/components/base/icons/src/public/files/Pdf'
import Txt from '@/app/components/base/icons/src/public/files/Txt'
import Unknown from '@/app/components/base/icons/src/public/files/Unknown'
import Xlsx from '@/app/components/base/icons/src/public/files/Xlsx'

type FileIconProps = {
  type: string
  className?: string
}

const FileIcon: FC<FileIconProps> = ({ type, className }) => {
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
