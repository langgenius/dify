import type { FC } from 'react'
import type { AgentV2NodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useNodeDataUpdate } from '../../hooks/use-node-data-update'

const strategyOptions = [
  { value: 'auto', label: 'Auto (based on model capability)' },
  { value: 'function-calling', label: 'Function Calling' },
  { value: 'chain-of-thought', label: 'ReAct (Chain of Thought)' },
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
      {/* Model */}
      <Field title={t('workflow.nodes.llm.model')}>
        <div className="rounded-lg border border-divider-subtle px-3 py-2 text-[13px] text-text-secondary">
          {inputs.model?.name
            ? `${inputs.model.provider?.split('/').pop()} / ${inputs.model.name}`
            : 'Not configured'}
        </div>
      </Field>

      <Split />

      {/* Strategy */}
      <Field title="Agent Strategy">
        <select
          className="w-full rounded-lg border border-components-input-border-active bg-transparent px-3 py-1.5 text-[13px] text-text-secondary"
          value={inputs.agent_strategy || 'auto'}
          onChange={e => updateData({ agent_strategy: e.target.value as any })}
        >
          {strategyOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      {/* Max Iterations */}
      <Field title="Max Iterations">
        <input
          type="number"
          min={1}
          max={99}
          className="w-full rounded-lg border border-components-input-border-active bg-transparent px-3 py-1.5 text-[13px] text-text-secondary"
          value={inputs.max_iterations || 10}
          onChange={e => updateData({ max_iterations: parseInt(e.target.value) || 10 })}
        />
      </Field>

      <Split />

      {/* Tools */}
      <Field title={`Tools (${(inputs.tools || []).filter(t => t.enabled).length})`}>
        <div className="space-y-2">
          {(inputs.tools || []).map((tool, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg border border-divider-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  onChange={e => {
                    const tools = [...(inputs.tools || [])]
                    tools[idx] = { ...tools[idx], enabled: e.target.checked }
                    updateData({ tools })
                  }}
                  className="h-4 w-4"
                />
                <span className="text-[13px] text-text-secondary">{tool.tool_name}</span>
              </div>
              <span className="text-[11px] text-text-quaternary">{tool.provider_name?.split('/').pop()}</span>
            </div>
          ))}
          {(inputs.tools || []).length === 0 && (
            <div className="py-3 text-center text-[13px] text-text-quaternary">
              No tools configured
            </div>
          )}
        </div>
      </Field>

      <Split />

      {/* Memory */}
      <Field title="Memory">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Window Size</span>
          <input
            type="number"
            min={1}
            max={200}
            className="w-20 rounded-lg border border-components-input-border-active bg-transparent px-2 py-1 text-center text-[13px] text-text-secondary"
            value={inputs.memory?.window?.size || 50}
            onChange={e => updateData({
              memory: {
                role_prefix: inputs.memory?.role_prefix,
                query_prompt_template: inputs.memory?.query_prompt_template,
                window: { enabled: true, size: parseInt(e.target.value) || 50 },
              },
            })}
          />
        </div>
      </Field>

      <Split />

      {/* Vision */}
      <Field title="Vision">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Enable image understanding</span>
          <input
            type="checkbox"
            checked={inputs.vision?.enabled || false}
            onChange={e => updateData({
              vision: { ...inputs.vision, enabled: e.target.checked },
            })}
            className="h-4 w-4"
          />
        </div>
      </Field>
    </div>
  )
}

Panel.displayName = 'AgentV2Panel'
export default memo(Panel)
