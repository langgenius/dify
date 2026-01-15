import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type EditorBodyProps = PropsWithChildren

const EditorBody: FC<EditorBodyProps> = ({ children }) => {
  return (
    <div className="flex min-h-0 flex-1">
      {children}
    </div>
  )
}

export default React.memo(EditorBody)
