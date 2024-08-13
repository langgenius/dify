import { memo } from 'react'
import { RiDownloadLine } from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import cn from '@/utils/classnames'
import ActionButton from '@/app/components/base/action-button'

type FileListItemProps = {
  isFile?: boolean
  className?: string
}
const FileListFlexItem = ({
  isFile,
  className,
}: FileListItemProps) => {
  if (isFile) {
    return (
      <div className={cn(
        'w-[144px] h-[68px] rounded-lg border-[0.5px] border-components-panel-border bg-components-card-bg-alt shadow-xs',
        className,
      )}>
        <div className='mb-1 h-8 line-clamp-2 system-xs-medium text-text-tertiary'></div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
            <FileTypeIcon
              size='sm'
              type='PDF'
              className='mr-1'
            />
            PDF
            <div className='mx-1'>·</div>
            3.9 MB
          </div>
          <ActionButton
            size='xs'
          >
            <RiDownloadLine className='w-3.5 h-3.5 text-text-tertiary' />
          </ActionButton>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'w-[68px] h-[68px] border-[2px] border-effects-image-frame shadow-xs',
      className,
    )}></div>
  )
}

export default memo(FileListFlexItem)
