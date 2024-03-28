'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import Tools from '@/app/components/tools'
import { LOC } from '@/app/components/tools/types'
import Drawer from '@/app/components/base/drawer-plus'
import ConfigContext from '@/context/debug-configuration'
import type { ModelConfig } from '@/models/debug'
import I18n from '@/context/i18n'

type Props = {
  show: boolean
  onHide: () => void
  selectedProviderId?: string
}

const ChooseTool: FC<Props> = ({
  show,
  onHide,
  selectedProviderId,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const {
    modelConfig,
    setModelConfig,
  } = useContext(ConfigContext)
  if (!show)
    return null

  return (
    <Drawer
      isShow
      onHide={onHide}
      title={t('tools.addTool') as string}
      panelClassName='mt-2 !w-[760px]'
      maxWidthClassName='!max-w-[760px]'
      height='calc(100vh - 16px)'
      contentClassName='!bg-gray-100'
      headerClassName='!border-b-black/5'
      body={
        <Tools
          loc={LOC.app}
          selectedProviderId={selectedProviderId}
          onAddTool={(collection, tool) => {
            const parameters: Record<string, string> = {}
            if (tool.parameters) {
              tool.parameters.forEach((item) => {
                parameters[item.name] = ''
              })
            }

            const nexModelConfig = produce(modelConfig, (draft: ModelConfig) => {
              draft.agentConfig.tools.push({
                provider_id: collection.id || collection.name,
                provider_type: collection.type,
                provider_name: collection.name,
                tool_name: tool.name,
                tool_label: tool.label[locale],
                tool_parameters: parameters,
                enabled: true,
              })
            })
            setModelConfig(nexModelConfig)
          }}
          addedTools={(modelConfig?.agentConfig?.tools as any) || []}
        />
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(ChooseTool)
