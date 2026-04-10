import type { FC } from 'react'
import type { AgentV2NodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine, RiDeleteBin7Line } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import ConfigVision from '../_base/components/config-vision'
import MemoryConfig from '../_base/components/memory-config'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import ConfigPrompt from '../llm/components/config-prompt'
import { useProviderContextSelector } from '@/context/provider-context'
import { useNodeDataUpdate } from '../../hooks/use-node-data-update'

const strategyOptions = [
  { value: 'auto', name: 'Auto (based on model capability)' },
  { value: 'function-calling', name: 'Function Calling' },
  { value: 'chain-of-thought', name: 'ReAct (Chain of Thought)' },
]

const Panel: FC<NodePanelProps<AgentV2NodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const { handleNodeDataUpdate } = useNodeDataUpdate()

  const updateData = useCallback((patch: Partial<AgentV2NodeType>) => {
    handleNodeDataUpdate({ id, data: patch as any })
  }, [id, handleNodeDataUpdate])

  const inputs = data as AgentV2NodeType

  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      {/* Model Selection */}
      <Field title={t('workflow.nodes.llm.model')}>
        <ModelParameterModal
          popupProps={{ disabled: false }}
          isInWorkflow
          isAdvancedMode
          mode={inputs.model?.mode || 'chat'}
          provider={inputs.model?.provider || ''}
          completionParams={inputs.model?.completion_params || {}}
          modelId={inputs.model?.name || ''}
          setModel={(model) => {
            updateData({
              model: {
                ...inputs.model,
                provider: model.provider,
                name: model.modelId,
                mode: model.mode || 'chat',
                completion_params: model.completionParams || {},
              },
            })
          }}
          onCompletionParamsChange={(params) => {
            updateData({
              model: { ...inputs.model, completion_params: params },
            })
          }}
        />
      </Field>

      <Split />

      {/* Agent Strategy */}
      <Field title="Agent Strategy">
        <Select
          items={strategyOptions}
          defaultValue={inputs.agent_strategy || 'auto'}
          onSelect={(item) => updateData({ agent_strategy: item.value as any })}
        />
      </Field>

      {/* Max Iterations */}
      <Field title="Max Iterations">
        <input
          type="number"
          min={1}
          max={99}
          className="w-full rounded-lg border border-components-input-border-active px-3 py-1.5 text-[13px]"
          value={inputs.max_iterations || 10}
          onChange={(e) => updateData({ max_iterations: parseInt(e.target.value) || 10 })}
        />
      </Field>

      <Split />

      {/* Tools */}
      <Field title={`Tools (${(inputs.tools || []).filter(t => t.enabled).length})`}>
        <div className="space-y-2">
          {(inputs.tools || []).map((tool, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg border border-divider-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  defaultValue={tool.enabled}
                  onChange={(v) => {
                    const tools = [...(inputs.tools || [])]
                    tools[idx] = { ...tools[idx], enabled: v }
                    updateData({ tools })
                  }}
                />
                <span className="text-[13px] text-text-secondary">{tool.tool_name}</span>
              </div>
              <span className="text-[11px] text-text-quaternary">{tool.provider_name?.split('/').pop()}</span>
            </div>
          ))}
          {(inputs.tools || []).length === 0 && (
            <div className="py-3 text-center text-[13px] text-text-quaternary">
              No tools configured. Add tools from the workflow toolbar.
            </div>
          )}
        </div>
      </Field>

      <Split />

      {/* Memory */}
      <Field title="Memory">
        <MemoryConfig
          readonly={false}
          config={inputs.memory || { window: { enabled: true, size: 50 } }}
          onChange={(memory) => updateData({ memory })}
        />
      </Field>

      <Split />

      {/* Vision */}
      <Field title="Vision">
        <ConfigVision
          payload={inputs.vision}
          onChange={(vision) => updateData({ vision })}
        />
      </Field>
    </div>
  )
}

Panel.displayName = 'AgentV2Panel'
export default memo(Panel)
