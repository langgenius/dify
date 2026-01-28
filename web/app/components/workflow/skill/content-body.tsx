import type { PropsWithChildren } from 'react'
import * as React from 'react'

type ContentBodyProps = PropsWithChildren

const ContentBody = ({ children }: ContentBodyProps) => {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {children}
    </div>
  )
}

export default React.memo(ContentBody)
