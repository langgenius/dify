'use client'
import { RiInformation2Fill } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  downloadUrl?: string
  className?: string
}

const LargeDataAlert: FC<Props> = ({
  downloadUrl,
  className,
}) => {
  const isShowDownload = !!downloadUrl
  const text = isShowDownload ? 'Large data - partial preview only' : 'Large data, read-only preview. Export to view all.'
  return (
    <div className={cn('flex h-8 items-center justify-between rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-2 shadow-xs', className)}>
      <div className='flex h-full items-center space-x-1'>
        <RiInformation2Fill className='size-4 text-text-accent' />
        <div className='system-xs-regular text-text-primary'>{text}</div>
      </div>
      {isShowDownload && (
        <div className='system-xs-medium-uppercase cursor-pointer text-text-accent'>Export</div>
      )}
    </div>
  )
}
export default React.memo(LargeDataAlert)
