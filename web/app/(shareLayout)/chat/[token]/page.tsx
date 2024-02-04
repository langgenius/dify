'use client'

import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/chat'
import ChatWithHistoryWrap from '@/app/components/base/chat/chat-with-history'

const Chat: FC<IMainProps> = () => {
  return (
    <ChatWithHistoryWrap />
  )
}

export default React.memo(Chat)
