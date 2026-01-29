import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const CODE_EXTENSIONS = ['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'psd', 'heic', 'heif', 'avif']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mpeg', 'mpg', 'm4v', 'avi', 'mkv', 'flv', 'wmv', '3gp']
const SQLITE_EXTENSIONS = ['db', 'sqlite', 'sqlite3']

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
    return extension.replace(/^\./, '').toLowerCase()
  if (!name)
    return ''
  return name.split('.').pop()?.toLowerCase() ?? ''
}

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'amr', 'mpga', 'ogg', 'flac', 'aac', 'wma', 'aiff', 'opus']
const PDF_EXTENSIONS = ['pdf']
const EXCEL_EXTENSIONS = ['xlsx', 'xls', 'csv']
const WORD_EXTENSIONS = ['doc', 'docx']
const PPT_EXTENSIONS = ['ppt', 'pptx']

const EXTENSION_TO_ICON_TYPE = new Map<string, FileAppearanceTypeEnum>(
  ([
    [['gif'], FileAppearanceTypeEnum.gif],
    [IMAGE_EXTENSIONS, FileAppearanceTypeEnum.image],
    [VIDEO_EXTENSIONS, FileAppearanceTypeEnum.video],
    [AUDIO_EXTENSIONS, FileAppearanceTypeEnum.audio],
    [PDF_EXTENSIONS, FileAppearanceTypeEnum.pdf],
    [MARKDOWN_EXTENSIONS, FileAppearanceTypeEnum.markdown],
    [EXCEL_EXTENSIONS, FileAppearanceTypeEnum.excel],
    [WORD_EXTENSIONS, FileAppearanceTypeEnum.word],
    [PPT_EXTENSIONS, FileAppearanceTypeEnum.ppt],
    [CODE_EXTENSIONS, FileAppearanceTypeEnum.code],
    [SQLITE_EXTENSIONS, FileAppearanceTypeEnum.database],
  ] as [string[], FileAppearanceTypeEnum][]).flatMap(
    ([exts, type]) => exts.map(e => [e, type] as [string, FileAppearanceTypeEnum]),
  ),
)

export function getFileIconType(name: string, ext?: string | null): FileAppearanceTypeEnum {
  const extension = ext?.replace(/^\./, '').toLowerCase() ?? name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TO_ICON_TYPE.get(extension) ?? FileAppearanceTypeEnum.document
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

export function isSQLiteFile(extension: string): boolean {
  return SQLITE_EXTENSIONS.includes(extension)
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
