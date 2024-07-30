import { memo } from 'react'
import {
  RiLink,
  RiUploadCloud2Line,
} from '@remixicon/react'
import FileInAttachmentItem from './file-in-attachment-item'
import Button from '@/app/components/base/button'

const FileUploaderInAttachment = () => {
  const options = [
    {
      value: 'local',
      label: 'Local upload',
      icon: <RiUploadCloud2Line className='w-4 h-4' />,
    },
    {
      value: 'link',
      label: 'Paste file link',
      icon: <RiLink className='w-4 h-4' />,
    },
  ]

  return (
    <div>
      <div className='flex items-center space-x-1'>
        {
          options.map(option => (
            <Button
              key={option.value}
              variant='tertiary'
              className='grow'
            >
              {option.icon}
              <span className='ml-1'>{option.label}</span>
            </Button>
          ))
        }
      </div>
      <div className='mt-1 space-y-1'>
        <FileInAttachmentItem />
        <FileInAttachmentItem />
      </div>
    </div>
  )
}

export default memo(FileUploaderInAttachment)
