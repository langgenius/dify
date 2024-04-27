'use client'
import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/chat'
import ChatWithHistoryWrap from '@/app/components/base/chat/chat-with-history'
import SSOForm from '@/app/components/share/ssoForm'

const Chat: FC<IMainProps> = () => {
  return (
    <SSOForm>
      <ChatWithHistoryWrap />
    </SSOForm>
  )
}

export default React.memo(Chat)
