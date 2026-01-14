import type { FC } from 'react'
import * as React from 'react'

const FileItem: FC = () => {
  return (
    <div
      className="h-6 rounded bg-gray-100"
      data-component="file-item"
    />
  )
}

export default React.memo(FileItem)
