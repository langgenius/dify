import { FILE_SIZE_LIMIT } from '@/app/components/base/file-uploader/constants'
import { useFileUploadConfig } from '@/service/use-common'

const BYTES_PER_MEBIBYTE = 1024 * 1024

export function useKnowledgeFileSizeLimit() {
  const { data: fileUploadConfig } = useFileUploadConfig()

  return (
    fileUploadConfig?.knowledge_file_size_limit ??
    fileUploadConfig?.file_size_limit ??
    FILE_SIZE_LIMIT / BYTES_PER_MEBIBYTE
  )
}
