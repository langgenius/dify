import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/chat'
import Main from '@/app/components/share/chatbot'
import SSOForm from '@/app/components/share/ssoForm'

const Chatbot: FC<IMainProps> = () => {
  return (
    <SSOForm>
      <Main />
    </SSOForm>
  )
}

export default React.memo(Chatbot)
