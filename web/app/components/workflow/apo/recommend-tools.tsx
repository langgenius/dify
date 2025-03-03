import React, { useCallback } from 'react'
import { useLanguage } from '../../header/account-setting/model-provider-page/hooks'
import Tooltip from '../../base/tooltip'
import type { OnSelectBlock } from '../types'
import { BlockEnum } from '../types'
import type { ToolDefaultValue } from '../block-selector/types'

type RecommendToolsPrps = {
  provider: any[]
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  closeModal: () => void
}
const RecommendTools = ({ provider, onSelect, closeModal }: RecommendToolsPrps) => {
  const language = useLanguage()
  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    onSelect(type, toolDefaultValue)
    closeModal()
  }, [])
  return <div>
    {provider.tools.map(tool => (
      <Tooltip
        key={tool.name}
        position='right'
        popupClassName='!p-0 !px-3 !py-2.5 !w-[200px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg'
        popupContent={(
          <div>
            {/* <BlockIcon
            size='md'
            className='mb-2'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          /> */}
            <div className='mb-1 text-sm leading-5 text-gray-900'>{tool.label[language]}</div>
            <div className='text-xs text-gray-700 leading-[18px]'>{tool.description[language]}</div>
          </div>
        )}
      >
        <div
          key={tool.name}
          className='rounded-lg pl-[21px] hover:bg-state-base-hover cursor-pointer'
          onClick={(e) => {
            const params: Record<string, string> = {}
            if (tool.parameters) {
              tool.parameters.forEach((item) => {
                params[item.name] = ''
              })
            }
            e.stopPropagation()
            handleSelect(BlockEnum.Tool, {
              provider_id: provider.id,
              provider_type: provider.type,
              provider_name: provider.name,
              tool_name: tool.name,
              tool_label: tool.label[language],
              title: tool.label[language],
              is_team_authorization: provider.is_team_authorization,
              output_schema: tool.output_schema,
              paramSchemas: tool.parameters,
              params,
            })
          }}
        >
          <div className='h-8 leading-8 border-l-2 border-divider-subtle pl-4 truncate text-text-secondary system-sm-medium'>{tool.label[language]}</div>
        </div>
      </Tooltip >
    ))}</div>
}
export default React.memo(RecommendTools)
