import React, { type FC } from 'react'
import Drawer from '@/app/components/base/drawer'
import classNames from '@/utils/classnames'
import { noop } from 'lodash-es'

type IFullScreenDrawerProps = {
  isOpen: boolean
  onClose?: () => void
  fullScreen: boolean
  children: React.ReactNode
}

const FullScreenDrawer: FC<IFullScreenDrawerProps> = ({
  isOpen,
  onClose = noop,
  fullScreen,
  children,
}) => {
  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      panelClassName={classNames('bg-components-panel-bg !p-0',
        fullScreen
          ? '!w-full !max-w-full'
          : 'mb-2 mr-2 mt-16 !w-[560px] !max-w-[560px] rounded-xl border-[0.5px] border-components-panel-border',
      )}
      mask={false}
      unmount
      footer={null}
    >
      {children}
    </Drawer>)
}

export default FullScreenDrawer
