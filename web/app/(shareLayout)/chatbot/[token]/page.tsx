import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/chat'
import Main from '@/app/components/share/chatbot'

const Chatbot: FC<IMainProps> = () => {
  return (
    <Main />
  )
}

export default React.memo(Chatbot)
