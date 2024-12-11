import React from 'react'

const Tag = ({ text }: { text: string }) => {
  return (
    <div className='inline-flex items-center gap-x-0.5'>
      <span className='text-text-quaternary text-xs font-medium'>#</span>
      <span className='text-text-tertiary text-xs'>{text}</span>
    </div>
  )
}

Tag.displayName = 'Tag'

export default React.memo(Tag)
