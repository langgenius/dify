'use client'
import type { FC } from 'react'
import React from 'react'
import Tools from '@/app/components/tools'
import { LOC } from '@/app/components/tools/types'
import Drawer from '@/app/components/base/drawer-plus'
type Props = {
  show: boolean
  onHide: () => void
}

const ChooseTool: FC<Props> = ({
  show,
  onHide,
}) => {
  if (!show)
    return null

  return (
    <Drawer
      isShow
      onHide={onHide}
      title='Choose a tool'
      panelClassName='mt-2 !w-[760px]'
      maxWidthClassName='!max-w-[760px]'
      height='calc(100vh - 16px)'
      contentClassName='!bg-gray-100'
      headerClassName='!border-b-black/5'
      body={
        <Tools loc={LOC.app} />
      }
    >
    </Drawer>

  )
}
export default React.memo(ChooseTool)
