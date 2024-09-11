import { useFile } from './hooks'

const FileInput = () => {
  const { handleLocalFileUpload } = useFile()
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (file)
      handleLocalFileUpload(file)
  }
  return (
    <input
      className='absolute block inset-0 opacity-0 text-[0] w-full disabled:cursor-not-allowed cursor-pointer'
      onClick={e => ((e.target as HTMLInputElement).value = '')}
      type='file'
      onChange={handleChange}
    />
  )
}

export default FileInput
