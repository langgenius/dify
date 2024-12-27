import React from 'react'
import cn from '@/utils/classnames'

const Tag = ({ text, className }: { text: string; className?: string }) => {
  return (
    <div className={cn('inline-flex items-center gap-x-0.5', className)}>
      <span className='text-text-quaternary text-xs font-medium'>#</span>
      <span className='text-text-tertiary text-xs max-w-12 line-clamp-1 shrink-0'>{text}</span>
    </div>
  )
}

Tag.displayName = 'Tag'

export default React.memo(Tag)
