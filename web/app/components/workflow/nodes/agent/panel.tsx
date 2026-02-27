import type { FC } from 'react'
import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { StrategyParamItem } from '@/app/components/plugins/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { toType } from '@/app/components/tools/utils/to-form-schema'
import { isSupportMCP } from '@/utils/plugin-version-feature'
import { useStore } from '../../store'
import { AgentStrategy } from '../_base/components/agent-strategy'
import Field from '../_base/components/field'
import { MCPToolAvailabilityProvider } from '../_base/components/mcp-tool-availability'
import MemoryConfig from '../_base/components/memory-config'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import Split from '../_base/components/split'
import { AgentFeature } from './types'
import useConfig from './use-config'

const i18nPrefix = 'nodes.agent'

export function strategyParamToCredientialForm(param: StrategyParamItem): CredentialFormSchema {
  return {
    ...param as any,
    variable: param.name,
    show_on: [],
    type: toType(param.type),
    tooltip: param.help,
  }
}

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const {
    inputs,
    setInputs,
    currentStrategy,
    formData,
    onFormChange,
    isChatMode,
    availableNodesWithParent,
    availableVars,
    readOnly,
    outputSchema,
    handleMemoryChange,
  } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  const isMCPVersionSupported = isSupportMCP(inputs.meta?.version)

  const resetEditor = useStore(s => s.setControlPromptEditorRerenderKey)
  return (
    <div className="my-2">
      <Field
        required
        title={t('nodes.agent.strategy.label', { ns: 'workflow' })}
        className="px-4 py-2"
        tooltip={t('nodes.agent.strategy.tooltip', { ns: 'workflow' })}
      >
        <MCPToolAvailabilityProvider versionSupported={isMCPVersionSupported}>
          <AgentStrategy
            strategy={inputs.agent_strategy_name
              ? {
                  agent_strategy_provider_name: inputs.agent_strategy_provider_name!,
                  agent_strategy_name: inputs.agent_strategy_name!,
                  agent_strategy_label: inputs.agent_strategy_label!,
                  agent_output_schema: inputs.output_schema,
                  plugin_unique_identifier: inputs.plugin_unique_identifier!,
                  meta: inputs.meta,
                }
              : undefined}
            onStrategyChange={(strategy) => {
              setInputs({
                ...inputs,
                agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
                agent_strategy_name: strategy?.agent_strategy_name,
                agent_strategy_label: strategy?.agent_strategy_label,
                output_schema: strategy!.agent_output_schema,
                plugin_unique_identifier: strategy!.plugin_unique_identifier,
                meta: strategy?.meta,
              })
              resetEditor(Date.now())
            }}
            formSchema={currentStrategy?.parameters?.map(strategyParamToCredientialForm) || []}
            formValue={formData}
            onFormValueChange={onFormChange}
            nodeOutputVars={availableVars}
            availableNodes={availableNodesWithParent}
            nodeId={props.id}
          />
        </MCPToolAvailabilityProvider>
      </Field>
      <div className="px-4 py-2">
        {isChatMode && currentStrategy?.features?.includes(AgentFeature.HISTORY_MESSAGES) && (
          <>
            <Split />
            <MemoryConfig
              className="mt-4"
              readonly={readOnly}
              config={{ data: inputs.memory }}
              onChange={handleMemoryChange}
              canSetRoleName={false}
            />
          </>
        )}
      </div>
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type="String"
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
          />
          <VarItem
            name="files"
            type="Array[File]"
            description={t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })}
          />
          <VarItem
            name="json"
            type="Array[Object]"
            description={t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })}
          />
          {outputSchema.map(({ name, type, description }) => (
            <VarItem
              key={name}
              name={name}
              type={type}
              description={description}
            />
          ))}
        </OutputVars>
      </div>
    </div>
  )
}

AgentPanel.displayName = 'AgentPanel'

export default memo(AgentPanel)
