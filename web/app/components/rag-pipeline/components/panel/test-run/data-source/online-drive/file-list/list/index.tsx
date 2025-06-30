import type { OnlineDriveFile } from '@/models/pipeline'
import Item from './item'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileList: string[]
}

const List = ({
  fileList,
  selectedFileList,
}: FileListProps) => {
  return (
    <div className='grow overflow-y-auto p-1 pt-0'>
      <div className='flex flex-col gap-y-px px-1 py-1.5'>
        {
          fileList.map((file) => {
            const isSelected = selectedFileList.includes(file.key)
            return (
              <Item
                key={file.key}
                file={file}
                isSelected={isSelected}
                onSelect={(file) => { console.log(file) }}
                onOpen={(file) => { console.log(file) }}
              />
            )
          })
        }
      </div>
    </div>
  )
}

export default List
