import type { FC } from 'react'
import React from 'react'

import type { IMainProps } from '@/app/components/share/text-generation'
import Main from '@/app/components/share/text-generation'
import SSOLayout from '@/app/components/share/ssoForm'

const TextGeneration: FC<IMainProps> = () => {
  return (
    <SSOLayout>
      <Main isWorkflow />
    </SSOLayout>
  )
}

export default React.memo(TextGeneration)
