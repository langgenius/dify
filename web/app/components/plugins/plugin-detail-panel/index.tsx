'use client'
import React from 'react'
import type { FC } from 'react'
import DetailHeader from './detail-header'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import ModelList from './model-list'
import Drawer from '@/app/components/base/drawer'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import cn from '@/utils/classnames'

type Props = {
  onUpdate: () => void
}

const PluginDetailPanel: FC<Props> = ({
  onUpdate,
}) => {
  const pluginDetail = usePluginPageContext(v => v.currentPluginDetail)
  const setCurrentPluginDetail = usePluginPageContext(v => v.setCurrentPluginDetail)

  const handleHide = () => setCurrentPluginDetail(undefined)

  const handleUpdate = (isDelete = false) => {
    if (isDelete)
      handleHide()
    onUpdate()
  }

  if (!pluginDetail)
    return null

  return (
    <Drawer
      isOpen={!!pluginDetail}
      clickOutsideNotOpen={false}
      onClose={handleHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      {pluginDetail && (
        <>
          <DetailHeader
            detail={pluginDetail}
            onHide={handleHide}
            onUpdate={handleUpdate}
          />
          <div className='grow overflow-y-auto'>
            {!!pluginDetail.declaration.tool && <ActionList />}
            {!!pluginDetail.declaration.endpoint && <EndpointList showTopBorder={!!pluginDetail.declaration.tool} />}
            {!!pluginDetail.declaration.model && <ModelList />}
          </div>
        </>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
