'use client'
import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { useCallback, useEffect } from 'react'
import Drawer from '@/app/components/base/drawer'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { cn } from '@/utils/classnames'
import { ReadmeEntrance } from '../readme-panel/entrance'
import ActionList from './action-list'
import AgentStrategyList from './agent-strategy-list'
import DatasourceActionList from './datasource-action-list'
import DetailHeader from './detail-header'
import EndpointList from './endpoint-list'
import ModelList from './model-list'
import { usePluginStore } from './store'
import { SubscriptionList } from './subscription-list'
import { TriggerEventsList } from './trigger/event-list'

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
  const handleUpdate = useCallback((isDelete = false) => {
    if (isDelete)
      onHide()
    onUpdate()
  }, [onHide, onUpdate])

  const { setDetail } = usePluginStore()

  useEffect(() => {
    setDetail(!detail
      ? undefined
      : {
          plugin_id: detail.plugin_id,
          provider: `${detail.plugin_id}/${detail.declaration.name}`,
          plugin_unique_identifier: detail.plugin_unique_identifier || '',
          declaration: detail.declaration,
          name: detail.name,
          id: detail.id,
        })
  }, [detail, setDetail])

  if (!detail)
    return null

  return (
    <Drawer
      isOpen={!!detail}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      {detail && (
        <>
          <DetailHeader detail={detail} onUpdate={handleUpdate} onHide={onHide} />
          <div className="grow overflow-y-auto">
            <div className="flex min-h-full flex-col">
              <div className="flex-1">
                {detail.declaration.category === PluginCategoryEnum.trigger && (
                  <>
                    <SubscriptionList pluginDetail={detail} />
                    <TriggerEventsList />
                  </>
                )}
                {!!detail.declaration.tool && <ActionList detail={detail} />}
                {!!detail.declaration.agent_strategy && <AgentStrategyList detail={detail} />}
                {!!detail.declaration.endpoint && <EndpointList detail={detail} />}
                {!!detail.declaration.model && <ModelList detail={detail} />}
                {!!detail.declaration.datasource && <DatasourceActionList detail={detail} />}
              </div>
              <ReadmeEntrance pluginDetail={detail} className="mt-auto" />
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
