import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type EditorTabsProps = PropsWithChildren

const EditorTabs: FC<EditorTabsProps> = ({ children }) => {
  return (
    <div
      className="flex items-center gap-2"
      data-component="editor-tabs"
    >
      {children}
    </div>
  )
}

export default React.memo(EditorTabs)
