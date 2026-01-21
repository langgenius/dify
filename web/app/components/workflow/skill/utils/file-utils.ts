import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const CODE_EXTENSIONS = ['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema']
const TEXT_EXTENSIONS = ['txt', 'log', 'ini', 'env']
const IGNORE_EXTENSIONS = ['gitignore', 'dockerignore', 'prettierignore', 'eslintignore', 'npmignore', 'hgignore']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mpeg', 'mpg', 'm4v', 'avi']

export function getFileExtension(name?: string, extension?: string): string {
  if (extension)
    return extension.toLowerCase()
  if (!name)
    return ''
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function getFileIconType(name: string): FileAppearanceTypeEnum {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  if (MARKDOWN_EXTENSIONS.includes(extension))
    return FileAppearanceTypeEnum.markdown

  if (CODE_EXTENSIONS.includes(extension))
    return FileAppearanceTypeEnum.code

  return FileAppearanceTypeEnum.document
}

export function isMarkdownFile(extension: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extension)
}

export function isCodeOrTextFile(extension: string): boolean {
  return CODE_EXTENSIONS.includes(extension) || TEXT_EXTENSIONS.includes(extension) || IGNORE_EXTENSIONS.includes(extension)
}

export function isImageFile(extension: string): boolean {
  return IMAGE_EXTENSIONS.includes(extension)
}

export function isVideoFile(extension: string): boolean {
  return VIDEO_EXTENSIONS.includes(extension)
}

export function getFileLanguage(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  const languageMap: Record<string, string> = {
    md: 'markdown',
    markdown: 'markdown',
    mdx: 'markdown',
    json: 'json',
    jsonl: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    html: 'html',
    css: 'css',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
  }

  return languageMap[extension] ?? 'plaintext'
}
