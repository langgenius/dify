import type { FC } from 'react'
import type { FileItem } from './text-generation-image-uploader'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type ImageListProps = {
  list: FileItem[]
  readonly?: boolean
  onRemove?: (fileItemId: string) => void
}

const ImageList: FC<ImageListProps> = ({
  list,
  readonly,
  onRemove,
}) => {
  return (
    <div className='flex'>
      {
        list.map(item => (
          <div
            key={item._id}
            className='group relative mr-1'>
            <img
              className='w-16 h-16 rounded-lg cursor-pointer'
              alt=''
              onLoad={() => {}}
              src={item.url}
            />
            {
              !readonly && (
                <div
                  className={`
                    hidden absolute z-10 -top-[9px] -right-[9px] group-hover:flex items-center justify-center w-[18px] h-[18px] 
                    bg-white hover:bg-gray-50 border-[0.5px] border-black/[0.02] rounded-2xl shadow-lg
                    cursor-pointer
                  `}
                  onClick={() => onRemove && onRemove(item._id)}
                >
                  <XClose className='w-3 h-3 text-gray-500' />
                </div>
              )
            }
          </div>
        ))
      }
    </div>
  )
}

export default ImageList
