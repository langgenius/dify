import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type FilesProps = PropsWithChildren

const Files: FC<FilesProps> = ({ children }) => {
  return (
    <div
      className="flex flex-1 flex-col gap-2 overflow-auto"
      data-component="files"
    >
      {children}
    </div>
  )
}

export default React.memo(Files)
