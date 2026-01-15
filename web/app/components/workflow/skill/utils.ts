import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const CODE_EXTENSIONS = ['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema']
const TEXT_EXTENSIONS = ['txt', 'log', 'ini', 'env']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mpeg', 'mpg', 'm4v', 'avi']
const OFFICE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']

export const getFileExtension = (name?: string, extension?: string) => {
  if (extension)
    return extension.toLowerCase()
  if (!name)
    return ''
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export const getFileIconType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  if (MARKDOWN_EXTENSIONS.includes(extension))
    return FileAppearanceTypeEnum.markdown

  if (CODE_EXTENSIONS.includes(extension))
    return FileAppearanceTypeEnum.code

  return FileAppearanceTypeEnum.document
}

export const isMarkdownFile = (extension: string) => MARKDOWN_EXTENSIONS.includes(extension)
export const isCodeOrTextFile = (extension: string) => CODE_EXTENSIONS.includes(extension) || TEXT_EXTENSIONS.includes(extension)
export const isImageFile = (extension: string) => IMAGE_EXTENSIONS.includes(extension)
export const isVideoFile = (extension: string) => VIDEO_EXTENSIONS.includes(extension)
export const isOfficeFile = (extension: string) => OFFICE_EXTENSIONS.includes(extension)

/**
 * Get Monaco editor language from file name extension
 */
export const getFileLanguage = (name: string): string => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  const languageMap: Record<string, string> = {
    // Markdown
    md: 'markdown',
    markdown: 'markdown',
    mdx: 'markdown',
    // JSON
    json: 'json',
    jsonl: 'json',
    // YAML
    yaml: 'yaml',
    yml: 'yaml',
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    // Python
    py: 'python',
    // Others
    html: 'html',
    css: 'css',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
  }

  return languageMap[extension] ?? 'plaintext'
}
