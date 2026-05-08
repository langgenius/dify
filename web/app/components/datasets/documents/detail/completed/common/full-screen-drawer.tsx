import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { noop } from 'es-toolkit/function'
import { CompletedDrawer } from './drawer'

type DocumentDetailDrawerProps = {
  open: boolean
  onClose?: () => void
  fullScreen: boolean
  modal?: boolean
  children: ReactNode
}

export function DocumentDetailDrawer({
  open,
  onClose = noop,
  fullScreen,
  children,
  modal = false,
}: DocumentDetailDrawerProps) {
  return (
    <CompletedDrawer
      open={open}
      onClose={onClose}
      panelClassName={cn(
        fullScreen
          ? 'w-full data-[swipe-direction=left]:w-full data-[swipe-direction=right]:w-full'
          : 'w-[568px] pt-16 pr-2 pb-2 data-[swipe-direction=left]:w-[568px] data-[swipe-direction=right]:w-[568px]',
      )}
      panelContentClassName={cn(
        'bg-components-panel-bg',
        !fullScreen && 'rounded-xl border-[0.5px] border-components-panel-border',
      )}
      modal={modal}
    >
      {children}
    </CompletedDrawer>
  )
}
