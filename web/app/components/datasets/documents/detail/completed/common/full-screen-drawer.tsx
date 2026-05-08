import type { PropsWithChildren } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { noop } from 'es-toolkit/function'
import { CompletedDrawer } from './drawer'

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
}: PropsWithChildren<IFullScreenDrawerProps>) => {
  return (
    <CompletedDrawer
      open={isOpen}
      onClose={onClose}
      panelClassName={cn(
        fullScreen
          ? 'w-full'
          : 'w-[568px] pt-16 pr-2 pb-2',
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
    </CompletedDrawer>
  )
}

export default FullScreenDrawer
