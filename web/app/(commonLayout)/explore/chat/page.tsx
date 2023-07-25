import type { FC } from 'react'
import React from 'react'
import UniversalChat from '@/app/components/explore/universal-chat'

const Chat: FC = () => {
  return (
    <div className='h-full p-2'>
      <UniversalChat />
    </div>
  )
}

export default React.memo(Chat)
