import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const CODE_EXTENSIONS = ['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'psd', 'heic', 'heif', 'avif']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mpeg', 'mpg', 'm4v', 'avi', 'mkv', 'flv', 'wmv', '3gp']

const BINARY_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'wma',
  'aiff',
  'opus',
  'zip',
  'tar',
  'gz',
  'rar',
  '7z',
  'bz2',
  'xz',
  'tgz',
  'tbz2',
  'lz',
  'lzma',
  'cab',
  'iso',
  'dmg',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'obj',
  'class',
  'pyc',
  'pyo',
  'pyd',
  'wasm',
  'app',
  'msi',
  'deb',
  'rpm',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'epub',
  'mobi',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  'db',
  'sqlite',
  'sqlite3',
  'mdb',
  'accdb',
  'jar',
  'war',
  'ear',
  'apk',
  'ipa',
  'aab',
  'lock',
]

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

export function isBinaryFile(extension: string): boolean {
  return BINARY_EXTENSIONS.includes(extension)
}

export function isTextLikeFile(extension: string): boolean {
  return !isBinaryFile(extension) && !isImageFile(extension) && !isVideoFile(extension)
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
