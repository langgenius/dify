import React, { type FC } from 'react'
import Drawer from '@/app/components/base/drawer'
import classNames from '@/utils/classnames'

type IFullScreenDrawerProps = {
  isOpen: boolean
  onClose?: () => void
  fullScreen: boolean
  children: React.ReactNode
}

const FullScreenDrawer: FC<IFullScreenDrawerProps> = ({
  isOpen,
  onClose = () => {},
  fullScreen,
  children,
}) => {
  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      panelClassname={classNames('!p-0 bg-components-panel-bg',
        fullScreen
          ? '!max-w-full !w-full'
          : 'mt-16 mr-2 mb-2 !max-w-[560px] !w-[560px] border-[0.5px] border-components-panel-border rounded-xl',
      )}
      mask={false}
      unmount
      footer={null}
    >
      {children}
    </Drawer>)
}

export default FullScreenDrawer
