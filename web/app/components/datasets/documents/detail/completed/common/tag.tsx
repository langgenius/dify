import React from 'react'
import cn from '@/utils/classnames'

const Tag = ({ text, className }: { text: string; className?: string }) => {
  return (
    <div className={cn('inline-flex items-center gap-x-0.5', className)}>
      <span className='text-xs font-medium text-text-quaternary'>#</span>
      <span className='line-clamp-1 max-w-12 shrink-0 text-xs text-text-tertiary'>{text}</span>
    </div>
  )
}

Tag.displayName = 'Tag'

export default React.memo(Tag)
