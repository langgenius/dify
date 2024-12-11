import React from 'react'

const Dot = () => {
  return (
    <div className='text-text-quaternary text-xs font-medium'>·</div>
  )
}

Dot.displayName = 'Dot'

export default React.memo(Dot)
