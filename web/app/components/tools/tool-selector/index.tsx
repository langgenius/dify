'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ToolTrigger from '@/app/components/tools/tool-selector/tool-trigger'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'

import { useAllBuiltInTools, useAllCustomTools, useAllWorkflowTools } from '@/service/use-tools'
// import AddToolModal from '@/app/components/tools/add-tool-modal'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'

type Props = {
  value?: {
    provider: string
    tool_name: string
  }
  disabled: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (tool: {
    provider: string
    tool_name: string
  }) => void
  supportAddCustomTool?: boolean
}
const ToolSelector: FC<Props> = ({
  value,
  disabled,
  placement = 'bottom',
  offset = 0,
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
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const [isShowSettingAuth, setShowSettingAuth] = useState(false)

  const handleToolAuthSetting = (value: any) => {
    // const newModelConfig = produce(modelConfig, (draft) => {
    //   const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === value?.collection?.id && item.tool_name === value?.tool_name)
    //   if (tool)
    //     (tool as AgentTool).notAuthor = false
    // })
    // setModelConfig(newModelConfig)
  }

  const handleSelectTool = (tool: ToolDefaultValue) => {
    const toolValue = {
      provider: tool.provider_id,
      tool_name: tool.tool_name,
    }
    onSelect(toolValue)
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
          <ToolTrigger open={isShow} provider={currentProvider} />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className="relative w-[389px] min-h-20 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
            <div className='px-4 py-3 flex flex-col gap-1'>
              <div className='h-6 flex items-center system-sm-regular text-text-secondary'>Tool</div>
              <ToolPicker
                placement='bottom'
                trigger={<ToolTrigger open={isShowChooseTool} provider={currentProvider} />}
                isShow={isShowChooseTool}
                onShowChange={setIsShowChooseTool}
                disabled={false}
                supportAddCustomTool
                onSelect={handleSelectTool}
              />
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(ToolSelector)
