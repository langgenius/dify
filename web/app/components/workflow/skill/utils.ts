import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

export const getFileIconType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  if (['md', 'markdown', 'mdx'].includes(extension))
    return FileAppearanceTypeEnum.markdown

  if (['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema'].includes(extension))
    return FileAppearanceTypeEnum.code

  return FileAppearanceTypeEnum.document
}
