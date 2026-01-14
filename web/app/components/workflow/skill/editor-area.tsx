import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type EditorAreaProps = PropsWithChildren

const EditorArea: FC<EditorAreaProps> = ({ children }) => {
  return (
    <section
      className="flex flex-1 flex-col gap-3 rounded-lg bg-white p-3"
      data-component="editor-area"
    >
      {children}
    </section>
  )
}

export default React.memo(EditorArea)
