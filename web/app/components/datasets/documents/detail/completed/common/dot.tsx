import React from 'react'

const Dot = () => {
  return (
    <div className='text-text-quaternary system-xs-medium'>·</div>
  )
}

Dot.displayName = 'Dot'

export default React.memo(Dot)
