import { memo } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import ActionButton from '@/app/components/base/action-button'

const FileInAttachmentItem = () => {
  return (
    <div className='flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs'>
      <div className='shrink-0 flex items-center justify-center w-12 h-12'>
        <FileTypeIcon type='AUDIO' />
      </div>
      <div className='grow'>
        <div className='mb-0.5 system-xs-medium text-text-secondary'>Yellow mountain range.jpg</div>
        <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
          <span>JPG</span>
          <span className='mx-1 system-2xs-medium'>•</span>
          <span>21.5 MB</span>
        </div>
      </div>
      <ActionButton className='shrink-0 mr-3'>
        <RiDeleteBinLine className='w-4 h-4' />
      </ActionButton>
    </div>
  )
}

export default memo(FileInAttachmentItem)
