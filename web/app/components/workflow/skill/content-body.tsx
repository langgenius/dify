import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type ContentBodyProps = PropsWithChildren

const ContentBody: FC<ContentBodyProps> = ({ children }) => {
  return (
    <div className="flex min-h-0 flex-1">
      {children}
    </div>
  )
}

export default React.memo(ContentBody)
