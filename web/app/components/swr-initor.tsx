'use client'

import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

type SwrInitorProps = {
  children: ReactNode
}
const SwrInitor = ({
  children,
}: SwrInitorProps) => {
  return (
    <SWRConfig value={{
      shouldRetryOnError: false,
    }}>
      {children}
    </SWRConfig>
  )
}

export default SwrInitor
