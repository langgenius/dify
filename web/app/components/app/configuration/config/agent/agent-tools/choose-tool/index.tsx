'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  if (!show)
    return null

  return (
    <Drawer
      isShow
      onHide={onHide}
      title={t('tools.chooseTool') as string}
      panelClassName='mt-2 !w-[760px]'
      maxWidthClassName='!max-w-[760px]'
      height='calc(100vh - 16px)'
      contentClassName='!bg-gray-100'
      headerClassName='!border-b-black/5'
      body={
        <Tools
          loc={LOC.app}
          onAddTool={() => { }}
          addedToolNames={['Add Pet']}
        />
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    >
    </Drawer>

  )
}
export default React.memo(ChooseTool)
