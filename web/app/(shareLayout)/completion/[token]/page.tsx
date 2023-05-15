import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/chat'
import Main from '@/app/components/share/text-generation'

const TextGeneration: FC<IMainProps> = () => {
  return (
    <Main />
  )
}

export default React.memo(TextGeneration)