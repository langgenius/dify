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
  [FileAppearanceTypeEnum.pdf]: {
    component: RiFilePdf2Fill,
    color: 'text-[#EA3434]',
  },
  [FileAppearanceTypeEnum.image]: {
    component: RiFileImageFill,
    color: 'text-[#00B2EA]',
  },
  [FileAppearanceTypeEnum.video]: {
    component: RiFileVideoFill,
    color: 'text-[#844FDA]',
  },
  [FileAppearanceTypeEnum.audio]: {
    component: RiFileMusicFill,
    color: 'text-[#FF3093]',
  },
  [FileAppearanceTypeEnum.document]: {
    component: RiFileTextFill,
    color: 'text-[#6F8BB5]',
  },
  [FileAppearanceTypeEnum.code]: {
    component: RiFileCodeFill,
    color: 'text-[#BCC0D1]',
  },
  [FileAppearanceTypeEnum.markdown]: {
    component: RiMarkdownFill,
    color: 'text-[#309BEC]',
  },
  [FileAppearanceTypeEnum.custom]: {
    component: RiFile3Fill,
    color: 'text-[#BCC0D1]',
  },
  [FileAppearanceTypeEnum.excel]: {
    component: RiFileExcelFill,
    color: 'text-[#01AC49]',
  },
  [FileAppearanceTypeEnum.word]: {
    component: RiFileWordFill,
    color: 'text-[#2684FF]',
  },
  [FileAppearanceTypeEnum.ppt]: {
    component: RiFilePpt2Fill,
    color: 'text-[#FF650F]',
  },
  [FileAppearanceTypeEnum.gif]: {
    component: RiFileGifFill,
    color: 'text-[#00B2EA]',
  },
}
type FileTypeIconProps = {
  type: FileAppearanceType
  size?: 'sm' | 'lg' | 'md'
  className?: string
}
const SizeMap = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
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
