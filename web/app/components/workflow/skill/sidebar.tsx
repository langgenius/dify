'use client'

import type { FC, PropsWithChildren } from 'react'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { storage } from '@/utils/storage'
import { useResizePanel } from '../nodes/_base/hooks/use-resize-panel'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from './constants'

type SidebarProps = PropsWithChildren

const Sidebar: FC<SidebarProps> = ({ children }) => {
  const { run: persistWidth } = useDebounceFn(
    (width: number) => storage.set(STORAGE_KEYS.SKILL.SIDEBAR_WIDTH, width),
    { wait: 200 },
  )

  const handleResize = useCallback((width: number) => {
    persistWidth(width)
  }, [persistWidth])

  const { triggerRef, containerRef } = useResizePanel({
    direction: 'horizontal',
    triggerDirection: 'right',
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    onResize: handleResize,
  })

  return (
    <aside
      ref={containerRef}
      style={{ width: storage.getNumber(STORAGE_KEYS.SKILL.SIDEBAR_WIDTH, SIDEBAR_DEFAULT_WIDTH) }}
      className="relative flex h-full shrink-0 flex-col gap-px overflow-hidden rounded-[10px] border border-components-panel-border-subtle bg-components-panel-bg"
    >
      {children}
      <div
        ref={triggerRef}
        className="absolute -right-1 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center"
      >
        <div className="h-10 w-0.5 rounded-sm bg-state-base-handle transition-all hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid" />
      </div>
    </aside>
  )
}

export default React.memo(Sidebar)
