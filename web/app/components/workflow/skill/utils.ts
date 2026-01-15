import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'

export const getFileIconType = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''

  if (['md', 'markdown', 'mdx'].includes(extension))
    return FileAppearanceTypeEnum.markdown

  if (['json', 'yaml', 'yml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'schema'].includes(extension))
    return FileAppearanceTypeEnum.code

  return FileAppearanceTypeEnum.document
}

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
