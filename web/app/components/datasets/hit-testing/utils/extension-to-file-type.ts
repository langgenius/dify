import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

export const extensionToFileType = (extension: string): FileAppearanceTypeEnum => {
  switch (extension) {
    case 'pdf':
      return FileAppearanceTypeEnum.pdf
    case 'doc':
    case 'docx':
      return FileAppearanceTypeEnum.word
    case 'txt':
    case 'epub':
      return FileAppearanceTypeEnum.document
    case 'md':
    case 'mdx':
    case 'markdown':
      return FileAppearanceTypeEnum.markdown
    case 'csv':
    case 'xls':
    case 'xlsx':
      return FileAppearanceTypeEnum.excel
    case 'html':
    case 'htm':
    case 'xml':
      return FileAppearanceTypeEnum.document
    case 'ppt':
    case 'pptx':
      return FileAppearanceTypeEnum.ppt
    default:
      return FileAppearanceTypeEnum.custom
  }
}
