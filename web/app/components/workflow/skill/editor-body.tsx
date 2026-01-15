import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type EditorBodyProps = PropsWithChildren

const EditorBody: FC<EditorBodyProps> = ({ children }) => {
  return (
    <div
      className="flex flex-1"
      data-component="editor-body"
    >
      {children}
    </div>
  )
}

export default React.memo(EditorBody)
