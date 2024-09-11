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
import { FileAppearanceTypeEnum } from './types'
import type { FileAppearanceType } from './types'
import cn from '@/utils/classnames'

const FILE_TYPE_ICON_MAP = {
  [FileAppearanceTypeEnum.PDF]: {
    component: RiFilePdf2Fill,
    color: 'text-[#EA3434]',
  },
  [FileAppearanceTypeEnum.IMAGE]: {
    component: RiFileImageFill,
    color: 'text-[#00B2EA]',
  },
  [FileAppearanceTypeEnum.VIDEO]: {
    component: RiFileVideoFill,
    color: 'text-[#844FDA]',
  },
  [FileAppearanceTypeEnum.AUDIO]: {
    component: RiFileMusicFill,
    color: 'text-[#FF3093]',
  },
  [FileAppearanceTypeEnum.DOCUMENT]: {
    component: RiFileTextFill,
    color: 'text-[#6F8BB5]',
  },
  [FileAppearanceTypeEnum.CODE]: {
    component: RiFileCodeFill,
    color: 'text-[#BCC0D1]',
  },
  [FileAppearanceTypeEnum.MARKDOWN]: {
    component: RiMarkdownFill,
    color: 'text-[#309BEC]',
  },
  [FileAppearanceTypeEnum.OTHER]: {
    component: RiFile3Fill,
    color: 'text-[#BCC0D1]',
  },
  [FileAppearanceTypeEnum.EXCEL]: {
    component: RiFileExcelFill,
    color: 'text-[#01AC49]',
  },
  [FileAppearanceTypeEnum.WORD]: {
    component: RiFileWordFill,
    color: 'text-[#2684FF]',
  },
  [FileAppearanceTypeEnum.PPT]: {
    component: RiFilePpt2Fill,
    color: 'text-[#FF650F]',
  },
  [FileAppearanceTypeEnum.GIF]: {
    component: RiFileGifFill,
    color: 'text-[#00B2EA]',
  },
}
type FileTypeIconProps = {
  type: FileAppearanceType
  size?: 'sm' | 'lg'
  className?: string
}
const SizeMap = {
  sm: 'w-4 h-4',
  lg: 'w-6 h-6',
}
const FileTypeIcon = ({
  type,
  size = 'sm',
  className,
}: FileTypeIconProps) => {
  const Icon = FILE_TYPE_ICON_MAP[type].component
  const color = FILE_TYPE_ICON_MAP[type].color

  if (!Icon)
    return null

  return <Icon className={cn('shrink-0', SizeMap[size], color, className)} />
}

export default memo(FileTypeIcon)
