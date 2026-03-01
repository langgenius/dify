'use client'
import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import * as React from 'react'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import FileTypeIcon from '../../base/file-uploader/file-type-icon'

const extendToFileTypeMap: { [key: string]: FileAppearanceType } = {
  pdf: FileAppearanceTypeEnum.pdf,
  json: FileAppearanceTypeEnum.document,
  html: FileAppearanceTypeEnum.document,
  txt: FileAppearanceTypeEnum.document,
  markdown: FileAppearanceTypeEnum.markdown,
  md: FileAppearanceTypeEnum.markdown,
  xlsx: FileAppearanceTypeEnum.excel,
  xls: FileAppearanceTypeEnum.excel,
  csv: FileAppearanceTypeEnum.excel,
  doc: FileAppearanceTypeEnum.word,
  docx: FileAppearanceTypeEnum.word,
}

type Props = {
  extension?: string
  name?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const DocumentFileIcon: FC<Props> = ({
  extension,
  name,
  size = 'md',
  className,
}) => {
  const localExtension = extension?.toLowerCase() || name?.split('.')?.pop()?.toLowerCase()
  return (
    <FileTypeIcon type={extendToFileTypeMap[localExtension!] || FileAppearanceTypeEnum.document} size={size} className={className} />
  )
}
export default React.memo(DocumentFileIcon)
