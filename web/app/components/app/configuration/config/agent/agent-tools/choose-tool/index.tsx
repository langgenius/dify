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
      // panelClassname='w-[760px] mt-16 mx-2 sm:mr-2 mb-3 !p-0 rounded-xl'
      body={
        <div>
          <Tools loc={LOC.app} />
        </div>
      }
    >
    </Drawer>

  )
}
export default React.memo(ChooseTool)
