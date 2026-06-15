import { RiDragDropLine } from '@remixicon/react'
import * as React from 'react'

const FooterTip = () => {
  return (
    <div className="flex shrink-0 items-center justify-center gap-x-2 py-4 text-text-quaternary">
      <RiDragDropLine className="size-4" />
      <span className="system-xs-regular">Drag to adjust grouping</span>
    </div>
  )
}

export default React.memo(FooterTip)
