import { memo } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import ActionButton from '@/app/components/base/action-button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'

const FileInAttachmentItem = () => {
  return (
    <div className='flex items-center px-3 h-12 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs'>
      <FileTypeIcon
        type='AUDIO'
        size='lg'
        className='mr-3'
      />
      <div className='grow'>
        <div className='mb-0.5 system-xs-medium text-text-secondary'>Yellow mountain range.jpg</div>
        <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
          <span>JPG</span>
          <span className='mx-1 system-2xs-medium'>•</span>
          <span>21.5 MB</span>
        </div>
      </div>
      <div className='shrink-0 flex items-center'>
        <ProgressCircle
          percentage={10}
        />
        <ActionButton>
          <RiDeleteBinLine className='w-4 h-4' />
        </ActionButton>
      </div>
    </div>
  )
}

export default memo(FileInAttachmentItem)
