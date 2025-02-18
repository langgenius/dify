import React from 'react'

const Header = () => {
  return (
    <div className='flex flex-col border-b-[0.5px] border-divider-regular'>
      {/* Title */}
      <div className='flex items-center px-2 py-1.5 text-text-primary system-md-semibold'>
        Pick Time
      </div>
    </div>
  )
}

export default React.memo(Header)
