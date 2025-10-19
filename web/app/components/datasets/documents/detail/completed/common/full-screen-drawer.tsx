import React from 'react'
import Drawer from './drawer'
import cn from '@/utils/classnames'
import { noop } from 'lodash-es'

type IFullScreenDrawerProps = {
  isOpen: boolean
  onClose?: () => void
  fullScreen: boolean
  showOverlay?: boolean
  needCheckChunks?: boolean
  modal?: boolean
}

const FullScreenDrawer = ({
  isOpen,
  onClose = noop,
  fullScreen,
  children,
  showOverlay = true,
  needCheckChunks = false,
  modal = false,
}: React.PropsWithChildren<IFullScreenDrawerProps>) => {
  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      panelClassName={cn(
        fullScreen
          ? 'w-full'
          : 'w-[560px] pb-2 pr-2 pt-16',
      )}
      panelContentClassName={cn(
        'bg-components-panel-bg',
        !fullScreen && 'rounded-xl border-[0.5px] border-components-panel-border',
      )}
      showOverlay={showOverlay}
      needCheckChunks={needCheckChunks}
      modal={modal}
    >
      {children}
    </Drawer>)
}

export default FullScreenDrawer
