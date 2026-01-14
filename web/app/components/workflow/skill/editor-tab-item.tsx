import type { FC } from 'react'
import * as React from 'react'

const EditorTabItem: FC = () => {
  return (
    <div
      className="h-7 w-24 rounded bg-gray-100"
      data-component="editor-tab-item"
    />
  )
}

export default React.memo(EditorTabItem)
