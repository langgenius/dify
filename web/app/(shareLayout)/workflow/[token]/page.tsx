import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/text-generation'
import Main from '@/app/components/share/text-generation'

const TextGeneration: FC<IMainProps> = () => {
  return (
    <Main isWorkflow />
  )
}

export default React.memo(TextGeneration)
