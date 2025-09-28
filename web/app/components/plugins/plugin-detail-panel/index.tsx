'use client'
import React from 'react'
import type { FC } from 'react'
import DetailHeader from './detail-header'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import DatasourceActionList from './datasource-action-list'
import ModelList from './model-list'
import AgentStrategyList from './agent-strategy-list'
import RuntimeTraffic from './runtime-traffic'
import Drawer from '@/app/components/base/drawer'
import type { PluginDetail } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'

type Props = {
  detail?: PluginDetail
  onUpdate: () => void
  onHide: () => void
}

const PluginDetailPanel: FC<Props> = ({
  detail,
  onUpdate,
  onHide,
}) => {
  const handleUpdate = (isDelete = false) => {
    if (isDelete)
      onHide()
    onUpdate()
  }

  const currentPluginID = usePluginPageContext(v => v.currentPluginID)

  return (
    <Drawer
      isOpen={!!currentPluginID}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      {detail ? (
        <>
          <DetailHeader
            detail={detail}
            onHide={onHide}
            onUpdate={handleUpdate}
          />
          <div className='grow overflow-y-auto'>
            <RuntimeTraffic pluginId={detail.plugin_id} onRefresh={handleUpdate} />
            {!!detail.declaration.tool && <ActionList detail={detail} />}
            {!!detail.declaration.agent_strategy && <AgentStrategyList detail={detail} />}
            {!!detail.declaration.endpoint && <EndpointList detail={detail} />}
            {!!detail.declaration.model && <ModelList detail={detail} />}
            {!!detail.declaration.datasource && <DatasourceActionList detail={detail} />}
          </div>
        </>
      ) : (
        <div className='p-4'>
          <div className='mb-2 h-4 w-32 animate-pulse rounded bg-slate-200' />
          <div className='space-y-2'>
            <div className='h-6 w-full animate-pulse rounded bg-slate-200' />
            <div className='h-6 w-full animate-pulse rounded bg-slate-200' />
            <div className='h-6 w-full animate-pulse rounded bg-slate-200' />
          </div>
          {currentPluginID && <RuntimeTraffic pluginId={currentPluginID} onRefresh={handleUpdate} />}
        </div>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
