'use client'
import React from 'react'
import type { FC } from 'react'
import DetailHeader from './detail-header'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import ModelList from './model-list'
import Drawer from '@/app/components/base/drawer'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import type { PluginDetail } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'

type Props = {
  detail?: PluginDetail
  onUpdate: () => void
}

const PluginDetailPanel: FC<Props> = ({
  detail,
  onUpdate,
}) => {
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)

  const handleHide = () => setCurrentPluginID(undefined)

  const handleUpdate = (isDelete = false) => {
    if (isDelete)
      handleHide()
    onUpdate()
  }

  if (!detail)
    return null

  return (
    <Drawer
      isOpen={!!detail}
      clickOutsideNotOpen={false}
      onClose={handleHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      {detail && (
        <>
          <DetailHeader
            detail={detail}
            onHide={handleHide}
            onUpdate={handleUpdate}
          />
          <div className='grow overflow-y-auto'>
            {!!detail.declaration.tool && <ActionList detail={detail} />}
            {!!detail.declaration.endpoint && <EndpointList detail={detail} />}
            {!!detail.declaration.model && <ModelList detail={detail} />}
          </div>
        </>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
