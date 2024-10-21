import { useFile } from './hooks'
import { useStore } from './store'
import type { FileUpload } from '@/app/components/base/features/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

type FileInputProps = {
  fileConfig: FileUpload
}
const FileInput = ({
  fileConfig,
}: FileInputProps) => {
  const files = useStore(s => s.files)
  const { handleLocalFileUpload } = useFile(fileConfig)
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (file)
      handleLocalFileUpload(file)
  }

  const allowedFileTypes = fileConfig.allowed_file_types
  const isCustom = allowedFileTypes?.includes(SupportUploadFileTypes.custom)
  const exts = isCustom ? (fileConfig.allowed_file_extensions?.map(item => `.${item}`) || []) : (allowedFileTypes?.map(type => FILE_EXTS[type]) || []).flat().map(item => `.${item}`)
  const accept = exts.join(',')

  return (
    <input
      className='absolute block inset-0 opacity-0 text-[0] w-full disabled:cursor-not-allowed cursor-pointer'
      onClick={e => ((e.target as HTMLInputElement).value = '')}
      type='file'
      onChange={handleChange}
      accept={accept}
      disabled={!!(fileConfig.number_limits && files.length >= fileConfig?.number_limits)}
    />
  )
}

export default FileInput
