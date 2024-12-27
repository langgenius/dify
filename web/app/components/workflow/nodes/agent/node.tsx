import { type FC, useMemo } from 'react'
import type { NodeProps } from '../../types'
import type { AgentNodeType } from './types'
import { SettingItem } from '../_base/components/setting-item'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { Group, GroupLabel } from '../_base/components/group'
import type { ToolIconProps } from './components/tool-icon'
import { ToolIcon } from './components/tool-icon'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'
import { useInstalledPluginList } from '@/service/use-plugins'

const AgentNode: FC<NodeProps<AgentNodeType>> = (props) => {
  const { inputs, currentStrategy } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  const pluginList = useInstalledPluginList()
  // TODO: Implement models
  const models = useMemo(() => {
    const models = []
    // if selected, show in node
    // if required and not selected, show empty selector
    // if not required and not selected, show nothing
  }, [currentStrategy, inputs.agent_parameters])

  const tools = useMemo(() => {
    const tools: Array<ToolIconProps> = []
    currentStrategy?.parameters.forEach((param) => {
      if (['array[tool]', 'tool'].includes(param.type)) {
        const vari = inputs.agent_parameters?.[param.name]
        if (!vari) return
        if (Array.isArray(vari.value)) {
          // TODO: Implement array of tools
        }
        else {
          // TODO: Implement single tool
        }
      }
    })
  }, [currentStrategy, inputs.agent_parameters])
  return <div className='mb-1 px-3 py-1 space-y-1'>
    {inputs.agent_strategy_name
      ? <SettingItem
        label={t('workflow.nodes.agent.strategy.shortLabel')}
        status='error'
        tooltip={t('workflow.nodes.agent.strategyNotInstallTooltip', {
          strategy: inputs.agent_strategy_label,
        })}
      >
        {inputs.agent_strategy_label}
      </SettingItem>
      : <SettingItem label={t('workflow.nodes.agent.strategyNotSet')} />}
    <Group
      label={<GroupLabel className='mt-1'>
        {t('workflow.nodes.agent.model')}
      </GroupLabel>}
    >
      <ModelSelector
        modelList={[]}
        readonly
      />
      <ModelSelector
        modelList={[]}
        readonly
      />
      <ModelSelector
        modelList={[]}
        readonly
      />
    </Group>
    <Group label={<GroupLabel className='mt-1'>
      {t('workflow.nodes.agent.toolbox')}
    </GroupLabel>}>
      <div className='grid grid-cols-10 gap-0.5'>
        <ToolIcon src='/logo/logo.png' />
        <ToolIcon
          src='/logo/logo.png'
          status='error'
          tooltip={t('workflow.nodes.agent.toolNotInstallTooltip', {
            tool: 'Gmail Sender',
          })} />
        <ToolIcon
          src='/logo/logo.png'
          status='warning'
          tooltip={t('workflow.nodes.agent.toolNotAuthorizedTooltip', {
            tool: 'DuckDuckGo AI Search',
          })} />
      </div>
    </Group>
  </div>
}

export default AgentNode