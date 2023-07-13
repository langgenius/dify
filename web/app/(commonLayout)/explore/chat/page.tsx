import type { FC } from 'react'
import React from 'react'
import UniversalChat from '@/app/components/explore/universal-chat'

const Chat: FC = () => {
  return (
    <UniversalChat />
  )
}

export default React.memo(Chat)
