'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppTrigger from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import Button from '@/app/components/base/button'

import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { CollectionType } from '@/app/components/tools/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import cn from '@/utils/classnames'

type Props = {
  value?: {
    provider: string
    tool_name: string
  }
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (tool: {
    provider: string
    tool_name: string
  }) => void
  supportAddCustomTool?: boolean
}
const AppSelector: FC<Props> = ({
  value,
  disabled,
  placement = 'bottom',
  offset = 4,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [isShow, onShowChange] = useState(false)
  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.id === value?.provider && toolWithProvider.tools.some(tool => tool.name === value?.tool_name)
    })
  }, [value, buildInTools, customTools, workflowTools])
  const [isShowChooseApp, setIsShowChooseApp] = useState(false)
  const handleSelectTool = (tool: ToolDefaultValue) => {
    const toolValue = {
      provider: tool.provider_id,
      tool_name: tool.tool_name,
    }
    onSelect(toolValue)
    setIsShowChooseApp(false)
    if (tool.provider_type === CollectionType.builtIn && tool.is_team_authorization)
      onShowChange(false)
  }

  return (
    <>
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          className='w-full'
          onClick={handleTriggerClick}
        >
          <AppTrigger
            open={isShow}
            appDetail={undefined}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className="relative w-[389px] min-h-20 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
            <div className='px-4 py-3 flex flex-col gap-1'>
              <div className='h-6 flex items-center system-sm-semibold text-text-secondary'>{t('tools.toolSelector.label')}</div>
              <ToolPicker
                placement='bottom'
                offset={offset}
                trigger={
                  <AppTrigger
                    open={isShowChooseApp}
                    appDetail={undefined}
                  />
                }
                isShow={isShowChooseApp}
                onShowChange={setIsShowChooseApp}
                disabled={false}
                supportAddCustomTool
                onSelect={handleSelectTool}
              />
            </div>
            {/* app inputs config panel */}
            <div className='px-4 py-3 flex items-center border-t border-divider-subtle'>
              <Button
                variant='primary'
                className={cn('shrink-0 w-full')}
                onClick={() => {}}
              >
                {t('tools.auth.unauthorized')}
              </Button>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(AppSelector)
