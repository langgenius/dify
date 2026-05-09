import type { DrawerRootProps } from '@langgenius/dify-ui/drawer'
import type { ReactNode } from 'react'
import { Drawer } from '@langgenius/dify-ui/drawer'
import * as React from 'react'

type AppInfoDetailDrawerProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
}

type DrawerOpenChange = NonNullable<DrawerRootProps['onOpenChange']>

export function AppInfoDetailDrawer({
  open,
  onClose,
  children,
}: AppInfoDetailDrawerProps) {
  const handleOpenChange = React.useCallback<DrawerOpenChange>((nextOpen) => {
    if (!nextOpen)
      onClose()
  }, [onClose])

  return (
    <Drawer
      open={open}
      modal={false}
      disablePointerDismissal
      swipeDirection="left"
      onOpenChange={handleOpenChange}
    >
      {open && (
        <div className="absolute inset-0 isolate">
          <button
            type="button"
            aria-label="Close app info"
            className="absolute inset-0 cursor-default bg-app-detail-overlay-bg"
            onClick={onClose}
          />
          <section
            role="dialog"
            aria-modal="false"
            className="absolute top-2 bottom-2 left-2 flex w-[452px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border-r border-divider-burn bg-app-detail-bg"
          >
            {children}
          </section>
        </div>
      )}
    </Drawer>
  )
}
