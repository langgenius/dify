import { getFileExtension, isMarkdownFile } from './file-utils'

const buildSkillUploadPayload = (content: string) => {
  return JSON.stringify({ content, metadata: {} })
}

export async function prepareSkillUploadFile(file: File): Promise<File> {
  const extension = getFileExtension(file.name)
  if (!isMarkdownFile(extension))
    return file

  const content = await file.text()
  const payload = buildSkillUploadPayload(content)
  return new File([payload], file.name, { type: file.type || 'text/plain' })
}
