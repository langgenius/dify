import type { FC } from 'react'
import React, { useMemo } from 'react'
import type { LLMNodeType } from './types'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import type { NodeProps } from '@/app/components/workflow/types'
import { Group, GroupLabel } from '../_base/components/group'
import { ToolIcon } from '../agent/components/tool-icon'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'

const Node: FC<NodeProps<LLMNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const { inputs } = useConfig(id, data)
  const { provider, name: modelId } = data.model || {}
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId

  // Extract tools information
  const tools = useMemo(() => {
    if (!inputs.tools || inputs.tools.length === 0)
      return []

    // For LLM Node, tools is ToolValue[]
    // Each tool has provider_name which is the unique identifier
    return inputs.tools.map((tool, index) => ({
      id: `tool-${index}`,
      providerName: tool.provider_name,
    }))
  }, [inputs.tools])

  if (!hasSetModel)
    return null

  return (
    <div className='mb-1 space-y-1 px-3 py-1'>
      {hasSetModel && (
        <ModelSelector
          defaultModel={{ provider, model: modelId }}
          modelList={textGenerationModelList}
          triggerClassName='!h-6 !rounded-md'
          readonly
        />
      )}

      {/* Tools display */}
      {tools.length > 0 && (
        <Group
          label={
            <GroupLabel className='mt-1'>
              {t('workflow.nodes.llm.tools')}
            </GroupLabel>
          }
        >
          <div className='grid grid-cols-10 gap-0.5'>
            {tools.map(tool => (
              <ToolIcon {...tool} key={tool.id} />
            ))}
          </div>
        </Group>
      )}
    </div>
  )
}

export default React.memo(Node)
