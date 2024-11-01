'use client'
import React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { EndpointListItem, PluginDetail } from '../types'
import DetailHeader from './detail-header'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import ModelList from './model-list'
import Drawer from '@/app/components/base/drawer'
import cn from '@/utils/classnames'

type Props = {
  pluginDetail: PluginDetail | undefined
  endpointList: EndpointListItem[]
  onHide: () => void
}

const PluginDetailPanel: FC<Props> = ({
  pluginDetail,
  endpointList = [],
  onHide,
}) => {
  const { t } = useTranslation()

  const handleDelete = () => {}

  if (!pluginDetail)
    return null

  return (
    <Drawer
      isOpen={!!pluginDetail}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      {pluginDetail && (
        <>
          <DetailHeader
            detail={pluginDetail}
            onHide={onHide}
            onDelete={handleDelete}
          />
          <div className='grow overflow-y-auto'>
            {!!pluginDetail.declaration.endpoint && (
              <EndpointList
                pluginUniqueID={pluginDetail.plugin_unique_identifier}
                list={endpointList}
                declaration={pluginDetail.declaration.endpoint}
              />
            )}
            {!!pluginDetail.declaration.tool && <ActionList />}
            {!!pluginDetail.declaration.model && <ModelList />}
          </div>
        </>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
