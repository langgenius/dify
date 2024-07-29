import { memo } from 'react'
import cn from '@/utils/classnames'

type FileListItemProps = {
  isFile?: boolean
  className?: string
}
const FileListItem = ({
  isFile,
  className,
}: FileListItemProps) => {
  if (isFile) {
    return (
      <div className={cn(
        'w-[144px] h-[68px] rounded-lg border-[0.5px] border-components-panel-border bg-components-card-bg-alt shadow-xs',
        className,
      )}>

      </div>
    )
  }

  return (
    <div className={cn(
      'w-[68px] h-[68px] border-[2px] border-components-panel-border shadow-xs',
      className,
    )}></div>
  )
}

export default memo(FileListItem)
