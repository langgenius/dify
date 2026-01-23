'use client'

import type { FC } from 'react'
import * as React from 'react'
import Home from '@/app/components/base/icons/src/vender/workflow/Home'

// TODO: use translations
const StartTabContent: FC = () => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-components-panel-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-components-panel-bg-blur">
          <Home className="size-6 text-text-tertiary" />
        </div>
        <span className="system-sm-regular text-text-tertiary">
          Coming soon...
        </span>
      </div>
    </div>
  )
}

export default React.memo(StartTabContent)
