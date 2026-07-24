import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'

export const getFileExtension = (fileName: string): string => {
  if (!fileName)
    return ''
  const parts = fileName.split('.')
  if (parts.length <= 1 || (parts[0] === '' && parts.length === 2))
    return ''

  return parts[parts.length - 1].toLowerCase()
}

export const getFileType = (fileName: string) => {
  const extension = getFileExtension(fileName)

  if (extension === 'gif')
    return FileAppearanceTypeEnum.gif

  if (FILE_EXTS.image.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.image

  if (FILE_EXTS.video.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.video

  if (FILE_EXTS.audio.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.audio

  if (extension === 'html' || extension === 'htm' || extension === 'xml' || extension === 'json')
    return FileAppearanceTypeEnum.code

  if (extension === 'pdf')
    return FileAppearanceTypeEnum.pdf

  if (extension === 'md' || extension === 'markdown' || extension === 'mdx')
    return FileAppearanceTypeEnum.markdown

  if (extension === 'xlsx' || extension === 'xls' || extension === 'csv')
    return FileAppearanceTypeEnum.excel

  if (extension === 'docx' || extension === 'doc')
    return FileAppearanceTypeEnum.word

  if (extension === 'pptx' || extension === 'ppt')
    return FileAppearanceTypeEnum.ppt

  if (FILE_EXTS.document.includes(extension.toUpperCase()))
    return FileAppearanceTypeEnum.document

  return FileAppearanceTypeEnum.custom
}
