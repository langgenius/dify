import { memo } from 'react'
import {
  RiFile3Fill,
  RiFileCodeFill,
  RiFileExcelFill,
  RiFileGifFill,
  RiFileImageFill,
  RiFileMusicFill,
  RiFilePdf2Fill,
  RiFilePpt2Fill,
  RiFileTextFill,
  RiFileVideoFill,
  RiFileWordFill,
  RiMarkdownFill,
} from '@remixicon/react'
import { FileTypeEnum } from './types'
import cn from '@/utils/classnames'

const FILE_TYPE_ICON_MAP = {
  [FileTypeEnum.PDF]: {
    component: RiFilePdf2Fill,
    color: 'text-[#EA3434]',
  },
  [FileTypeEnum.IMAGE]: {
    component: RiFileImageFill,
    color: 'text-[#00B2EA]',
  },
  [FileTypeEnum.VIDEO]: {
    component: RiFileVideoFill,
    color: 'text-[#844FDA]',
  },
  [FileTypeEnum.AUDIO]: {
    component: RiFileMusicFill,
    color: 'text-[#FF3093]',
  },
  [FileTypeEnum.DOCUMENT]: {
    component: RiFileTextFill,
    color: 'text-[#6F8BB5]',
  },
  [FileTypeEnum.CODE]: {
    component: RiFileCodeFill,
    color: 'text-[#BCC0D1]',
  },
  [FileTypeEnum.MARKDOWN]: {
    component: RiMarkdownFill,
    color: 'text-[#309BEC]',
  },
  [FileTypeEnum.OTHER]: {
    component: RiFile3Fill,
    color: 'text-[#BCC0D1]',
  },
  [FileTypeEnum.EXCEL]: {
    component: RiFileExcelFill,
    color: 'text-[#01AC49]',
  },
  [FileTypeEnum.WORD]: {
    component: RiFileWordFill,
    color: 'text-[#2684FF]',
  },
  [FileTypeEnum.PPT]: {
    component: RiFilePpt2Fill,
    color: 'text-[#FF650F]',
  },
  [FileTypeEnum.GIF]: {
    component: RiFileGifFill,
    color: 'text-[#00B2EA]',
  },
}
type FileTypeIconProps = {
  type: keyof typeof FileTypeEnum
  className?: string
}
const FileTypeIcon = ({
  type,
  className,
}: FileTypeIconProps) => {
  const Icon = FILE_TYPE_ICON_MAP[type].component
  const color = FILE_TYPE_ICON_MAP[type].color

  if (!Icon)
    return null

  return <Icon className={cn('w-5 h-5', color, className)} />
}

export default memo(FileTypeIcon)
